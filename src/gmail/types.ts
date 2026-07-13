export interface EmailSourceConfig {
  id: number;
  userId: number;
  name: string;
  emailAddress: string;
  imapPasswordEncrypted: string;
  targetSenders: string[];
  domainId: number;
  status: 'active' | 'inactive';
  lastFetchedAt: string | null;
  lastError: string | null;
}

export interface ParsedEmail {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  date: Date;
  html: string | null;
  text: string | null;
}

export interface EmailFetchResult {
  sourceId: number;
  success: boolean;
  emailsFound: number;
  emailsNew: number;
  error?: string;
  duration: number;
}
