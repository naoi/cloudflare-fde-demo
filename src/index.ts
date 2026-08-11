/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/messages" && request.method === "GET") {
      const { results } = await env.cf_fde_demo_db
        .prepare(
          `
          SELECT id, original, summary, created_at
          FROM messages
          ORDER BY id DESC
          LIMIT 20
          `
        )
        .all();

      return Response.json({
        messages: results,
      });
    }
    const messagePathMatch = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
    if (
      messagePathMatch &&
      (request.method === "GET" || request.method === "DELETE")
    ) {
      const id = Number(messagePathMatch[1]);

      if (
        !/^\d+$/.test(messagePathMatch[1]) ||
        !Number.isSafeInteger(id) ||
        id < 1
      ) {
        return Response.json({ error: "invalid message id" }, { status: 400 });
      }

      if (request.method === "DELETE") {
        const result = await env.cf_fde_demo_db
          .prepare("DELETE FROM messages WHERE id = ?")
          .bind(id)
          .run();

        if (result.meta.changes === 0) {
          return Response.json(
            { error: "message not found" },
            { status: 404 }
          );
        }

        return Response.json({ deleted: true, id });
      }

      const message = await env.cf_fde_demo_db
        .prepare(
          `
          SELECT id, original, summary, created_at
          FROM messages
          WHERE id = ?
          `
        )
        .bind(id)
        .first();

      if (!message) {
        return Response.json(
          { error: "message not found" },
          { status: 404 }
        );
      }

      return Response.json(message);
    }
    if (url.pathname === "/api/message" && request.method === "POST") {
      try {
        const body = await request.json<{ message?: string }>();

        if (!body.message || body.message.trim().length === 0) {
          return Response.json(
            { error: "message is required" },
            { status: 400 }
          );
        }

        if (body.message.length > 2000) {
          return Response.json(
            { error: "message is too long" },
            { status: 400 }
          );
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.2-3b-instruct",
          {
            prompt: `Summarize the following text in exactly one short sentence. Do not add commentary.

Text:
${body.message}`,
            max_tokens: 60,
            temperature: 0.2,
          },
          {
            gateway: {
              id: "default",
              skipCache: true,
              collectLog: true,
            },
          }
        );

        const summary = result.response ?? "";

        await env.cf_fde_demo_db
          .prepare(
            `
            INSERT INTO messages (original, summary)
            VALUES (?, ?)
            `
          )
          .bind(body.message, summary)
          .run();

        return Response.json({
          original: body.message,
          summary,
          saved: true,
        });
      } catch (error) {
        console.error(error);

        return Response.json(
          { error: "internal server error" },
          { status: 500 }
        );
      }
    }

    return Response.json({
      message: "Cloudflare FDE AI demo",
    });
  },
};
