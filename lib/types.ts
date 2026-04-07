export type FuelType = 'benzina' | 'diesel' | 'gpl' | 'metano' | 'benzina_plus' | 'diesel_plus';

export const FUEL_LABELS: Record<FuelType, string> = {
  benzina: 'Benzina',
  diesel: 'Gasolio',
  gpl: 'GPL',
  metano: 'Metano',
  benzina_plus: 'Benzina Plus',
  diesel_plus: 'Gasolio Plus',
};

export interface FuelPrice {
  fuelDescription: string;
  price: number;
  isSelf: boolean;
  updatedAt: string;
}

export interface FuelStation {
  id: number;
  manager: string;
  flag: string;
  type: string;
  name: string;
  address: string;
  city: string;
  province: string;
  lat: number;
  lon: number;
  prices: FuelPrice[];
  distanceMeters?: number;
  bestPrice?: number | null;
  bestPriceIsSelf?: boolean;
}

export function matchesFuel(desc: string, fuel: FuelType): boolean {
  const d = desc.toLowerCase();
  const isPlus = /(plus|speciale|v-power|hi-q|excellium|blusuper|blu super|blu diesel|blue diesel)/.test(d);
  switch (fuel) {
    case 'benzina':       return d.includes('benzina') && !isPlus;
    case 'benzina_plus':  return d.includes('benzina') && isPlus;
    case 'diesel':        return (d.includes('gasolio') || d.includes('diesel')) && !isPlus;
    case 'diesel_plus':   return (d.includes('gasolio') || d.includes('diesel')) && isPlus;
    case 'gpl':           return d.includes('gpl');
    case 'metano':        return d.includes('metano') || d.includes('gnl') || d.includes('gnc');
  }
}
