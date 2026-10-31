import { MovementApp } from "../src/components/movement-app";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  const allowed = ["activities", "map", "find", "create", "profile"];
  return (
    <MovementApp
      initialTab={section && allowed.includes(section) ? section : "activities"}
    />
  );
}
