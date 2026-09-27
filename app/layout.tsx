import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DriveVault",
  description: "Kho lưu trữ nhanh dùng Google Drive / Google Sheets",
  applicationName: "DriveVault",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1220",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
