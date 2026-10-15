"use client";
/** Staff logins and roles, crew employees, and company tablets. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatPhone } from "@css/domain";
import { Alert, Badge, Button, Card, Checkbox, FormField, Input, Modal, Select, errorText, timeAgo } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type Staff = Out["admin"]["config"]["staff"][number];
type Employee = Out["admin"]["config"]["employees"][number];
const ROLES = ["owner", "office", "dispatcher", "warehouse", "readonly"] as const;

export default function People() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const me = useQuery(trpc.admin.me.queryOptions()).data;
  const staff = useQuery(trpc.admin.config.staff.queryOptions(undefined, { enabled: me?.role === "owner" })).data;
  const employees = useQuery(trpc.admin.config.employees.queryOptions()).data;
  const day = useQuery(trpc.admin.crews.day.queryOptions({ date: new Date().toISOString().slice(0, 10) })).data;
  const [editStaff, setEditStaff] = useState<Partial<Staff> | null>(null);
  const [editEmp, setEditEmp] = useState<Partial<Employee> | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const createDevice = useMutation(trpc.admin.config.createDevice.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const revoke = useMutation(trpc.admin.config.revokeDevice.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  return (
    <div className="space-y-4">
      <PageHeader title="Staff & crew" />
      {me?.role === "owner" && (
        <Card title="Office logins" actions={<Button size="sm" onClick={() => setEditStaff({ role: "office", active: true })}>Add login</Button>}>
          <p className="mb-2 text-xs text-slate-500">Owner: everything (refunds over $100, write-offs, setup). Office: bookings, billing, messages. Dispatcher: calendar and crews. Warehouse: storage. Read-only: look only.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {staff?.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1.5">
                <span>
                  {s.name} · {s.email} <Badge tone="blue">{s.role}</Badge> {!s.active && <Badge tone="red">disabled</Badge>}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditStaff(s)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Crew employees" actions={<Button size="sm" onClick={() => setEditEmp({ active: true, defaultRoles: ["mover"] })}>Add employee</Button>}>
        <p className="mb-2 text-xs text-slate-500">Their phone gets their crew assignment by text when you publish a day. Nobody installs anything.</p>
        <ul className="divide-y divide-slate-100 text-sm">
          {employees?.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-1.5">
              <span className={e.active ? "" : "text-slate-400"}>
                {e.firstName} {e.lastName} · {formatPhone(e.phone)} · {e.defaultRoles.join(", ")} {!e.active && <Badge>inactive</Badge>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditEmp(e)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Crew tablets">
        <ul className="divide-y divide-slate-100 text-sm">
          {day?.devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-1.5">
              <span>
                {d.name} · last seen {timeAgo(d.lastSeenAt)}
              </span>
              {me?.role === "owner" && !d.name.includes("(revoked)") && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => window.confirm(`Revoke ${d.name}? It stops working immediately.`) && revoke.mutate({ deviceId: d.id })}>
                  Revoke (lost/stolen)
                </Button>
              )}
            </li>
          ))}
        </ul>
        {me?.role === "owner" && (
          <div className="mt-3 flex gap-2">
            <Input placeholder="Tablet name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className="max-w-48" />
            <Button variant="secondary" disabled={!deviceName} onClick={() => createDevice.mutate({ name: deviceName })} loading={createDevice.isPending}>
              Add tablet
            </Button>
          </div>
        )}
        {createDevice.data && (
          <Alert tone="amber">
            Pairing code for the new tablet (shown once): <code className="font-bold">{createDevice.data.pairingCode}</code>. Enter it in the crew app with this server's address.
          </Alert>
        )}
      </Card>
      {editStaff && <StaffModal s={editStaff} onClose={() => setEditStaff(null)} />}
      {editEmp && <EmployeeModal e={editEmp} roles={day?.roles ?? []} onClose={() => setEditEmp(null)} />}
    </div>
  );
}

function StaffModal({ s, onClose }: { s: Partial<Staff>; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({ name: s.name ?? "", email: s.email ?? "", role: (s.role ?? "office") as (typeof ROLES)[number], active: s.active ?? true, password: "" });
  const save = useMutation(trpc.admin.config.saveStaff.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  return (
    <Modal open onClose={onClose} title={s.id ? `Edit ${s.name}` : "Add login"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </FormField>
        <FormField label="Email">
          <Input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </FormField>
        <FormField label="Role">
          <Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as typeof v.role })}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={s.id ? "New password (optional)" : "Starting password"} help="At least 10 characters">
          <Input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </FormField>
        <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Can sign in" />
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate({ id: s.id ?? null, ...v, password: v.password || null })}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

function EmployeeModal({ e, roles, onClose }: { e: Partial<Employee>; roles: string[]; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({ firstName: e.firstName ?? "", lastName: e.lastName ?? "", phone: e.phone ?? "", defaultRoles: e.defaultRoles ?? [], active: e.active ?? true });
  const save = useMutation(trpc.admin.config.saveEmployee.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  return (
    <Modal open onClose={onClose} title={e.id ? `Edit ${e.firstName}` : "Add employee"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="First name">
          <Input value={v.firstName} onChange={(x) => setV({ ...v, firstName: x.target.value })} />
        </FormField>
        <FormField label="Last name">
          <Input value={v.lastName} onChange={(x) => setV({ ...v, lastName: x.target.value })} />
        </FormField>
        <FormField label="Mobile" className="sm:col-span-2">
          <Input value={v.phone} onChange={(x) => setV({ ...v, phone: x.target.value })} />
        </FormField>
        <FormField label="Usual roles" className="sm:col-span-2">
          <div className="flex flex-wrap gap-3">
            {roles.map((r) => (
              <Checkbox key={r} checked={v.defaultRoles.includes(r)} onChange={(on) => setV({ ...v, defaultRoles: on ? [...v.defaultRoles, r] : v.defaultRoles.filter((x) => x !== r) })} label={r} />
            ))}
          </div>
        </FormField>
        <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Active" />
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate({ id: e.id ?? null, ...v })}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
