import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function fetchWorker(path: string, method = "GET") {
	const request = new IncomingRequest(`http://example.com${path}`, { method });
	return worker.fetch(request, env);
}

describe("messages API", () => {
	beforeEach(async () => {
		await env.cf_fde_demo_db
			.prepare(`
				CREATE TABLE IF NOT EXISTS messages (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					original TEXT NOT NULL,
					summary TEXT NOT NULL,
					created_at TEXT DEFAULT CURRENT_TIMESTAMP
				)
			`)
			.run();
		await env.cf_fde_demo_db.prepare("DELETE FROM messages").run();
	});

	it("deletes an existing message", async () => {
		const inserted = await env.cf_fde_demo_db
			.prepare("INSERT INTO messages (original, summary) VALUES (?, ?)")
			.bind("Original", "Summary")
			.run();
		const id = inserted.meta.last_row_id;

		const response = await fetchWorker(`/api/messages/${id}`, "DELETE");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ deleted: true, id });
		expect(
			await env.cf_fde_demo_db
				.prepare("SELECT id FROM messages WHERE id = ?")
				.bind(id)
				.first()
		).toBeNull();
	});

	it("returns 404 when the message does not exist", async () => {
		const response = await fetchWorker("/api/messages/999", "DELETE");

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "message not found" });
	});

	it.each(["abc", "0", "-1", "1.5", "9007199254740992"])(
		"returns 400 for invalid ID %s",
		async (id) => {
			const response = await fetchWorker(`/api/messages/${id}`, "DELETE");

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: "invalid message id" });
		}
	);

	it("preserves the existing root endpoint", async () => {
		const request = new IncomingRequest("http://example.com");
		const response = await worker.fetch(request, env);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			message: "Cloudflare FDE AI demo",
		});
	});
});
