import { Tracking } from "./tracking";

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Tracking token={token} />;
}
