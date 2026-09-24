import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AIQuiz — Documentele tale, quiz-uri interactive',
  description:
    'Transformă PDF și DOCX în quiz-uri în limba română. Cont privat, cu documente și progres salvate în siguranță.',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
