export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webContentLink?: string;
  createdTime?: string;
  size?: string;
}

export interface ParsedCard {
  name: string;
  company: string;
  title: string;
  emails: string[];
  phones: string[];
  websites: string[];
  address: string;
  socials: string[];
  notes: string;
}

export interface CardPair {
  id: string;
  name: string;
  frontFile: DriveFile;
  backFile?: DriveFile;
  mergedLocalUrl?: string; // local preview url if merged locally
  mergedFileId?: string; // Google Drive file ID of the saved merged card
  status: "idle" | "merging" | "merged" | "saving" | "saved" | "parsing" | "parsed" | "error";
  error?: string;
  parsedData?: ParsedCard;
  layout: "horizontal" | "vertical";
  spacerColor: string; // hex code or 'none'
  gapSize: number; // in px
}
