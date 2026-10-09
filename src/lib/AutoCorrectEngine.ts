import { similarityRatio } from './FuzzyMatcher';

const CATEGORY_DICTIONARY: Record<string, string[]> = {
  'Groceries': ['groceries', 'grosery', 'grocery', 'kirana', 'kiranam', 'supermarket', 'ration', 'd-mart'],
  'Utilities': ['utilities', 'electricity', 'elecricity', 'bijli', 'current bill', 'water', 'gas', 'indane', 'cylinder', 'internet', 'wifi'],
  'Dairy & Milk': ['dairy', 'milk', 'doodh', 'paalu', 'heritage', 'amul'],
  'Transport': ['transport', 'petrol', 'diesel', 'fuel', 'bus', 'auto', 'ola', 'uber', 'train', 'metro'],
  'Medical': ['medical', 'hospital', 'doctor', 'medicines', 'dawai', 'mందులు', 'pharmacy', 'apollo'],
  'Rent & Maintenance': ['rent', 'maintenance', 'kiraya', 'bhadige'],
  'Maid & Staff': ['maid', 'staff', 'kamwali', 'pani manishi', 'driver', 'watchman'],
  'Shopping': ['shopping', 'clothes', 'kapde', 'batalu', 'amazon', 'flipkart', 'myntra'],
  'Food & Dining': ['food', 'dining', 'restaurant', 'swiggy', 'zomato', 'hotel', 'tiffin', 'snacks'],
  'Education': ['education', 'school', 'college', 'fees', 'books', 'tuition'],
  'Entertainment': ['entertainment', 'movies', 'cinema', 'theatre', 'netflix', 'prime'],
};

export interface ResolvedCategory {
  categoryId: string;
  confidence: number;
  isFuzzy: boolean;
}

export function resolveCategory(input: string): ResolvedCategory {
  const normalizedInput = input.trim().toLowerCase();
  
  if (!normalizedInput) return { categoryId: 'Other', confidence: 0, isFuzzy: false };

  let bestMatch = 'Other';
  let highestRatio = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_DICTIONARY)) {
    for (const keyword of keywords) {
      // 1. Exact Match
      if (keyword === normalizedInput) {
        return { categoryId: category, confidence: 1.0, isFuzzy: false };
      }
      
      // 2. Substring Match (e.g., input "kiranam shop" contains "kiranam")
      if (normalizedInput.includes(keyword) || keyword.includes(normalizedInput)) {
        // Boost confidence for substrings
        const ratio = 0.85; 
        if (ratio > highestRatio) {
          highestRatio = ratio;
          bestMatch = category;
        }
      }

      // 3. Fuzzy Match (Levenshtein)
      const ratio = similarityRatio(normalizedInput, keyword);
      if (ratio > highestRatio) {
        highestRatio = ratio;
        bestMatch = category;
      }
    }
  }

  // Threshold for accepting a fuzzy match
  if (highestRatio >= 0.70) {
    return { categoryId: bestMatch, confidence: highestRatio, isFuzzy: true };
  }

  // Fallback if unrecognized
  return { categoryId: 'Other', confidence: highestRatio, isFuzzy: true };
}
