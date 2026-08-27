import "./globals.css";

export const metadata = {
  title: "NiMSA Category B Awards",
  description: "Vote for the Category B NiMSA Awards personalities.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}