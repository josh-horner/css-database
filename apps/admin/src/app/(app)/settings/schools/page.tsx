"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { cx } from "@css/ui";
import { Alert, Badge, Button, Card, Checkbox, FormField, Input, Modal, Select, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader, human } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type School = Out["admin"]["config"]["schools"][number];
type Residence = School["residences"][number];

export default function Schools() {
  const trpc = useTRPC();
  const schools = useQuery(trpc.admin.config.schools.queryOptions()).data;
  const [school, setSchool] = useState<Partial<School> | null>(null);
  const [residence, setResidence] = useState<Partial<Residence> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Schools & residences" subtitle="School colors print on labels and color the calendar." actions={<Button onClick={() => setSchool({ active: true, color: "#1d4ed8", lat: 40, lng: -105 })}>Add school</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {schools?.map((s) => (
          <Card
            key={s.id}
            title={
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full" style={{ background: s.color }} />
                {s.name} {!s.active && <Badge>inactive</Badge>}
              </span>
            }
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => setSchool(s)}>
                  Edit
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setResidence({ schoolId: s.id, kind: "dorm", active: true, lat: s.lat, lng: s.lng, address: `${s.city}, CO` })}>
                  Add residence
                </Button>
              </>
            }
          >
            <p className="text-xs text-slate-500">
              {s.shortName} · {s.city} {s.allowsSpecialPickup && "· offers special pickups"}
            </p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {s.residences.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setResidence(r)} className={cx("hover:underline", !r.active && "text-slate-400 line-through")}>
                    {r.name}
                  </button>{" "}
                  <span className="text-xs text-slate-500">{human(r.kind)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {school && <SchoolModal s={school} onClose={() => setSchool(null)} />}
      {residence && <ResidenceModal r={residence} onClose={() => setResidence(null)} />}
    </div>
  );
}

function SchoolModal({ s, onClose }: { s: Partial<School>; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({ name: s.name ?? "", shortName: s.shortName ?? "", city: s.city ?? "", color: s.color ?? "#1d4ed8", lat: String(s.lat ?? ""), lng: String(s.lng ?? ""), active: s.active ?? true, allowsSpecialPickup: s.allowsSpecialPickup ?? false });
  const save = useMutation(trpc.admin.config.saveSchool.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  return (
    <Modal open onClose={onClose} title={s.id ? `Edit ${s.name}` : "Add school"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </FormField>
        <FormField label="Short name">
          <Input value={v.shortName} onChange={(e) => setV({ ...v, shortName: e.target.value })} />
        </FormField>
        <FormField label="City">
          <Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
        </FormField>
        <FormField label="Color">
          <Input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} className="h-10 p-1" />
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Lat">
            <Input value={v.lat} onChange={(e) => setV({ ...v, lat: e.target.value })} />
          </FormField>
          <FormField label="Lng">
            <Input value={v.lng} onChange={(e) => setV({ ...v, lng: e.target.value })} />
          </FormField>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox checked={v.allowsSpecialPickup} onChange={(c) => setV({ ...v, allowsSpecialPickup: c })} label="Offer paid special pickups at signup" />
          <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Active" />
        </div>
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate({ id: s.id ?? null, ...v, lat: Number(v.lat), lng: Number(v.lng) })}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

function ResidenceModal({ r, onClose }: { r: Partial<Residence>; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({ name: r.name ?? "", kind: r.kind ?? "dorm", address: r.address ?? "", lat: String(r.lat ?? ""), lng: String(r.lng ?? ""), active: r.active ?? true });
  const save = useMutation(trpc.admin.config.saveResidence.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  return (
    <Modal open onClose={onClose} title={r.id ? `Edit ${r.name}` : "Add residence"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </FormField>
        <FormField label="Kind" help="Dorms are on campus (date-only pickups); others ask for a street address.">
          <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>
            <option value="dorm">Residence hall</option>
            <option value="greek">Greek house</option>
            <option value="off_campus">Off campus</option>
          </Select>
        </FormField>
        <FormField label="Address">
          <Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </FormField>
        <FormField label="Lat">
          <Input value={v.lat} onChange={(e) => setV({ ...v, lat: e.target.value })} />
        </FormField>
        <FormField label="Lng">
          <Input value={v.lng} onChange={(e) => setV({ ...v, lng: e.target.value })} />
        </FormField>
        <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Active (shown at signup)" />
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate({ id: r.id ?? null, schoolId: r.schoolId!, ...v, lat: Number(v.lat), lng: Number(v.lng) })}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
