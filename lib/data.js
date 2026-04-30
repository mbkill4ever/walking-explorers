// Server-side route catalog. Mirrors what the client knows but kept here so
// /api/routes/generate can score without exposing the ranking algorithm.
export const ROUTES = [
  { id: 'soho_aesthetic',     nbhd: 'soho',         moods: ['aesthetic','vintage','coffee'],   minutes: 90,  miles: 1.7 },
  { id: 'ev_vintage',         nbhd: 'ev',           moods: ['vintage','music','coffee'],       minutes: 110, miles: 2.0 },
  { id: 'wv_books',           nbhd: 'westvillage',  moods: ['books','aesthetic','coffee'],     minutes: 75,  miles: 1.4 },
  { id: 'highline_galleries', nbhd: 'chelsea',      moods: ['art','nature','aesthetic'],       minutes: 130, miles: 2.4 },
  { id: 'williamsburg',       nbhd: 'williamsburg', moods: ['art','music','coffee'],           minutes: 100, miles: 1.9 },
  { id: 'dumbo_bridge',       nbhd: 'dumbo',        moods: ['aesthetic','history','sunset'],   minutes: 90,  miles: 1.8 },
  { id: 'central_park',       nbhd: 'centralpark',  moods: ['nature','history','aesthetic'],   minutes: 120, miles: 2.3 },
  { id: 'les_food',           nbhd: 'les',          moods: ['food','vintage','history'],       minutes: 110, miles: 1.6 },
  { id: 'soho_galleries',     nbhd: 'soho',         moods: ['art','aesthetic','history'],      minutes: 100, miles: 1.5 },
  { id: 'uws_classic',        nbhd: 'centralpark',  moods: ['history','books','food','music'], minutes: 110, miles: 2.0 },
  { id: 'harlem_history',     nbhd: 'centralpark',  moods: ['history','music','food','art'],   minutes: 120, miles: 2.2 },
  { id: 'fidi_finance',       nbhd: 'dumbo',        moods: ['history','aesthetic','art'],      minutes: 90,  miles: 1.7 }
];
