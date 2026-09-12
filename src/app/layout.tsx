import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FormChain — Move with intention",
  description:
    "A movement lab for reviewing squat repetitions, keyframes, and coaching cues.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
