import { Wizard } from "./wizard";

export const metadata = { title: "Sign up · College Student Storage" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ ref?: string; via?: string }> }) {
  const { ref, via } = await searchParams;
  return <Wizard refCode={ref ?? null} via={via ?? null} />;
}
