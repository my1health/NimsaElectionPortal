import "./globals.css";

export const metadata = {
  title: "NiMSA • Asclepius Awards 2026",
  description:
    "NiMSA Asclepius Awards 2026 — Official Voting Portal.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
