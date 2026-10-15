import { Pay } from "./pay";

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Pay token={token} />;
}
