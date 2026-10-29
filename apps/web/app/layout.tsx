import type { Metadata } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Providers } from "../src/components/providers";
export const metadata: Metadata = {
  title: "DIXON — Свои люди. В движении.",
  description: "Находи компанию для спорта и встреч в реальной жизни.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
