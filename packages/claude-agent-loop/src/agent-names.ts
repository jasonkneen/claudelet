import { uniqueNamesGenerator, adjectives } from 'unique-names-generator';

const cities: string[] = [
  'tokyo', 'paris', 'london', 'berlin', 'sydney', 'mumbai', 'cairo', 'rome',
  'athens', 'vienna', 'prague', 'dublin', 'lisbon', 'madrid', 'barcelona',
  'amsterdam', 'brussels', 'copenhagen', 'stockholm', 'oslo', 'helsinki',
  'warsaw', 'budapest', 'bucharest', 'sofia', 'belgrade', 'zagreb', 'venice',
  'milan', 'florence', 'naples', 'geneva', 'zurich', 'munich', 'hamburg',
  'frankfurt', 'cologne', 'lyon', 'marseille', 'bordeaux', 'nice', 'monaco',
  'edinburgh', 'manchester', 'liverpool', 'birmingham', 'glasgow', 'oxford',
  'cambridge', 'york', 'bath', 'cardiff', 'belfast', 'cork', 'galway',
  'seoul', 'osaka', 'kyoto', 'beijing', 'shanghai', 'hongkong', 'taipei',
  'singapore', 'bangkok', 'hanoi', 'jakarta', 'manila', 'kualalumpur',
  'delhi', 'kolkata', 'chennai', 'bangalore', 'hyderabad', 'karachi',
  'lahore', 'dhaka', 'colombo', 'kathmandu', 'tehran', 'baghdad', 'riyadh',
  'dubai', 'abudhabi', 'doha', 'kuwait', 'amman', 'beirut', 'damascus',
  'jerusalem', 'telaviv', 'istanbul', 'ankara', 'izmir', 'tbilisi', 'baku',
  'yerevan', 'tashkent', 'almaty', 'ulaanbaatar', 'vladivostok', 'moscow',
  'stpetersburg', 'kiev', 'minsk', 'riga', 'tallinn', 'vilnius', 'helsinki',
  'nairobi', 'lagos', 'accra', 'dakar', 'casablanca', 'marrakech', 'tunis',
  'algiers', 'tripoli', 'addisababa', 'capetown', 'johannesburg', 'durban',
  'pretoria', 'harare', 'lusaka', 'kampala', 'dares', 'mombasa', 'kinshasa',
  'newyork', 'losangeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
  'sanantonio', 'sandiego', 'dallas', 'austin', 'seattle', 'denver',
  'boston', 'miami', 'atlanta', 'detroit', 'minneapolis', 'portland',
  'lasvegas', 'sanfrancisco', 'oakland', 'sacramento', 'orlando', 'tampa',
  'nashville', 'charlotte', 'pittsburgh', 'baltimore', 'milwaukee', 'newark',
  'toronto', 'montreal', 'vancouver', 'calgary', 'ottawa', 'edmonton',
  'winnipeg', 'quebec', 'halifax', 'victoria', 'mexicocity', 'guadalajara',
  'monterrey', 'tijuana', 'cancun', 'havana', 'nassau', 'kingston', 'panama',
  'sanjose', 'bogota', 'medellin', 'lima', 'quito', 'caracas', 'santiago',
  'buenosaires', 'montevideo', 'asuncion', 'lapaz', 'brasilia', 'saopaulo',
  'rio', 'salvador', 'recife', 'fortaleza', 'belem', 'manaus', 'perth',
  'melbourne', 'brisbane', 'adelaide', 'canberra', 'darwin', 'hobart',
  'auckland', 'wellington', 'christchurch', 'fiji', 'tahiti', 'honolulu'
];

const usedNames = new Set<string>();

export function generateAgentName(): string {
  let name: string;
  let attempts = 0;
  const maxAttempts = 100;
  
  do {
    name = uniqueNamesGenerator({
      dictionaries: [adjectives, cities],
      separator: '-',
      style: 'lowerCase'
    });
    attempts++;
  } while (usedNames.has(name) && attempts < maxAttempts);
  
  if (usedNames.has(name)) {
    name = `${name}-${Date.now() % 1000}`;
  }
  
  usedNames.add(name);
  return name;
}

export function resetAgentNames(): void {
  usedNames.clear();
}
