import type { Metadata } from 'next';
import './globals.css';
import 'mapbox-gl/dist/mapbox-gl.css';

export const metadata: Metadata = {
  title: 'FuelFinder — Distributori in Italia',
  description: 'Trova i distributori di benzina più economici vicino a te. Dati ufficiali MISE in tempo reale.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
