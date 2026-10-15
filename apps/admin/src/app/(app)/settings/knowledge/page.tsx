"use client";
/** Knowledge base: what the assistant may answer from. Escalated questions suggest new articles. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Badge, Button, Card, Checkbox, FormField, Input, Modal, Textarea, errorText, formatDateTime } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type Article = Out["admin"]["config"]["kb"]["articles"][number];

export default function Knowledge() {
  const trpc = useTRPC();
  const kb = useQuery(trpc.admin.config.kb.queryOptions()).data;
  const [edit, setEdit] = useState<Partial<Article> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Knowledge base"
        subtitle="The assistant answers customer texts only from these articles and the customer's own booking. Anything else comes to you."
        actions={<Button onClick={() => setEdit({ public: true, active: true })}>New article</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-2">
          {kb?.articles.map((a) => (
            <Card key={a.id} title={<span>{a.title} {!a.active && <Badge>off</Badge>}</span>} actions={<Button size="sm" variant="ghost" onClick={() => setEdit(a)}>Edit</Button>}>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{a.body}</p>
            </Card>
          ))}
        </div>
        <Card title="Questions it couldn't answer">
          <p className="mb-2 text-xs text-slate-500">Recent escalations. If one keeps coming up, write an article and the next customer gets the answer.</p>
          <ul className="space-y-2 text-sm">
            {kb?.suggestions.map((s, i) => (
              <li key={i} className="rounded-md bg-slate-50 p-2">
                <div>“{s.body}”</div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {s.intent} · {formatDateTime(s.at)}
                  </span>
                  <button className="text-brand underline" onClick={() => setEdit({ title: "", body: "", public: true, active: true })}>
                    Write article
                  </button>
                </div>
              </li>
            ))}
            {kb?.suggestions.length === 0 && <li className="text-slate-500">Nothing escalated yet.</li>}
          </ul>
        </Card>
      </div>
      {edit && <ArticleModal a={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ArticleModal({ a, onClose }: { a: Partial<Article>; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({ title: a.title ?? "", body: a.body ?? "", public: a.public ?? true, active: a.active ?? true });
  const save = useMutation(trpc.admin.config.saveKb.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  return (
    <Modal open onClose={onClose} title={a.id ? "Edit article" : "New article"} wide>
      <div className="space-y-3">
        <FormField label="Title">
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </FormField>
        <FormField label="What customers should know" help="Plain facts and policy. The assistant won't promise anything beyond this.">
          <Textarea value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className="min-h-48" />
        </FormField>
        <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Assistant may use this" />
        <Checkbox checked={v.public} onChange={(c) => setV({ ...v, public: c })} label="OK to show on public help pages" />
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate({ id: a.id ?? null, ...v })}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
