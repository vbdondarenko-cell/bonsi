import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const upload = vi.fn();
const remove = vi.fn();
const rpc = vi.fn();
const projectLookup = vi.fn();
let actor: unknown = null;

vi.mock("@/lib/files/actor", () => ({ getActor: async () => actor }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ storage: { from: () => ({ upload, remove }) } }) }));

import { POST } from "./route";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
function makeActor(role: "admin" | "client") {
  return {
    role,
    userId: "u1",
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: projectLookup }) }) }), rpc },
  };
}
function request(files: Array<[string, Uint8Array]>, fields: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, bytes] of files) form.append("files", new File([bytes], name));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const probe = new Request("http://localhost/x", { method: "POST", body: form });
  return probe.arrayBuffer().then((buf) =>
    new Request("http://localhost/api/projects/" + PROJECT + "/files", {
      method: "POST",
      body: buf,
      headers: { "content-type": probe.headers.get("content-type")!, "content-length": String(buf.byteLength), ...headers },
    }),
  );
}
const ctx = (id = PROJECT) => ({ params: Promise.resolve({ id }) });

describe("POST /api/projects/[id]/files", () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    remove.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset().mockResolvedValue({ data: "file-1", error: null });
    projectLookup.mockReset().mockResolvedValue({ data: { id: PROJECT }, error: null });
    actor = makeActor("client");
  });

  it("міжсайтовий запит — 403", async () => {
    expect((await POST(await request([["a.png", PNG]], {}, { origin: "https://evil.example" }), ctx())).status).toBe(403);
  });
  it("без сесії — 401, некоректний id — 404", async () => {
    actor = null;
    expect((await POST(await request([["a.png", PNG]]), ctx())).status).toBe(401);
    actor = makeActor("client");
    expect((await POST(await request([["a.png", PNG]]), ctx("not-a-uuid"))).status).toBe(404);
  });
  it("чужий або неіснуючий проєкт (RLS не повернув рядка) — 404 і нічого не завантажено", async () => {
    projectLookup.mockResolvedValue({ data: null, error: null });
    expect((await POST(await request([["a.png", PNG]]), ctx())).status).toBe(404);
    expect(upload).not.toHaveBeenCalled();
  });
  it("клієнт не може обрати адмінську категорію", async () => {
    expect((await POST(await request([["a.png", PNG]], { category: "final" }), ctx())).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
  it("без Content-Length — 411", async () => {
    const req = new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=x" } });
    req.headers.delete("content-length");
    expect((await POST(req, ctx())).status).toBe(411);
  });
  it("небезпечний файл відхиляється до завантаження у сховище", async () => {
    const res = await POST(await request([["virus.exe", Uint8Array.from([0x4d, 0x5a])], ["fake.png", Uint8Array.from([1, 2, 3])]]), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.saved).toEqual([]);
    expect(body.failed).toHaveLength(2);
    expect(upload).not.toHaveBeenCalled();
  });
  it("успіх: об'єкт у приватному шляху проєкту, реєстрація через RPC клієнта", async () => {
    const res = await POST(await request([["logo.png", PNG]], { category: "logo" }), ctx());
    expect(res.status).toBe(201);
    expect((await res.json()).saved).toEqual([{ id: "file-1", name: "logo.png" }]);
    expect(upload.mock.calls[0]![0]).toMatch(new RegExp(`^${PROJECT}/[0-9a-f-]{36}$`));
    expect(upload.mock.calls[0]![2]).toMatchObject({ contentType: "image/png", upsert: false });
    expect(rpc).toHaveBeenCalledWith("client_register_file", expect.objectContaining({ p_project: PROJECT, p_category: "logo", p_mime: "image/png" }));
  });
  it("якщо база відмовила, завантажений об'єкт видаляється", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    const res = await POST(await request([["logo.png", PNG]]), ctx());
    expect(res.status).toBe(400);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("адміністратор може ділитися фінальними файлами й ховати службові", async () => {
    actor = makeActor("admin");
    const res = await POST(await request([["site.zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])]], { category: "final", visible: "false" }), ctx());
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("admin_register_file", expect.objectContaining({ p_category: "final", p_visible: false }));
  });
});
