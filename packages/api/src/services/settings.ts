import { schema, type DbOrTx } from "@css/db";
import { resolveSettings, Settings, type Settings as SettingsT } from "@css/domain";

export async function getSettings(db: DbOrTx): Promise<SettingsT> {
  return resolveSettings(await db.select().from(schema.settings));
}

/** Validates one owner setting against its schema before saving. */
export async function setSetting(db: DbOrTx, key: keyof SettingsT, value: unknown) {
  const parsed = Settings.shape[key].parse(value);
  await db
    .insert(schema.settings)
    .values({ key, value: parsed })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: parsed } });
  return parsed;
}
