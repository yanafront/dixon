import { MovementApp } from "../../src/components/movement-app";
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const allowed = ["activities", "map", "find", "create", "profile"];
  return (
    <MovementApp
      initialTab="notifications"
      returnTab={from && allowed.includes(from) ? from : "activities"}
    />
  );
}
