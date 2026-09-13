import type { Metadata } from "next";
import { Chakra_Petch, Inter } from "next/font/google";
import "./globals.css";
import NoirStage from "@/components/noir-stage";

const hud = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-hud",
});
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "FormChain — Move with intention",
  description:
    "A movement lab for reviewing squat repetitions, keyframes, and coaching cues.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={hud.variable + " " + body.variable}>
      <body>
        <NoirStage />
        {children}
      </body>
    </html>
  );
}
