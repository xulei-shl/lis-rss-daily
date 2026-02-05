/**
 * Script to check for potential duplicate articles
 * Finds articles that might be duplicates based on similar URLs or titles
 */

import { getDb } from '../src/db.js';

interface DuplicateGroup {
  canonicalUrl: string;
  urls: string[];
  ids: number[];
  count: number;
}

async function normalizeUrl(url: string): Promise<string> {
  // Remove trailing slash
  let normalized = url.replace(/\/$/, '');
  // Remove common tracking parameters
  try {
    const urlObj = new URL(normalized);
    // Remove UTM parameters, ref, source, etc.
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source', 'fbclid', 'gclid'];
    paramsToRemove.forEach(param => urlObj.searchParams.delete(param));
    // Remove timestamp-like parameters if value is numeric
    urlObj.searchParams.forEach((value, key) => {
      if (/^(t|time|ts|timestamp|date|v|version)$/i.test(key) && /^\d+$/.test(value)) {
        urlObj.searchParams.delete(key);
      }
    });
    normalized = urlObj.toString();
  } catch {
    // Invalid URL, return as-is
  }
  return normalized;
}

function getTitleSimilarity(title1: string, title2: string): number {
  // Simple similarity check
  const t1 = title1.toLowerCase().trim();
  const t2 = title2.toLowerCase().trim();
  if (t1 === t2) return 1.0;
  if (t1.includes(t2) || t2.includes(t1)) return 0.8;
  return 0;
}

async function checkDuplicates() {
  const db = getDb();
  console.log('=== Checking for potential duplicate articles ===\n');

  // Get all articles grouped by RSS source
  const articles = await db
    .selectFrom('articles')
    .select(['id', 'rss_source_id', 'title', 'url', 'created_at'])
    .orderBy('created_at', 'asc')
    .execute();

  console.log(`Total articles in database: ${articles.length}\n`);

  // Group by normalized URL
  const urlGroups = new Map<string, DuplicateGroup>();
  const titleGroups = new Map<string, number[]>();

  for (const article of articles) {
    const normalizedUrl = await normalizeUrl(article.url);

    if (!urlGroups.has(normalizedUrl)) {
      urlGroups.set(normalizedUrl, {
        canonicalUrl: normalizedUrl,
        urls: [],
        ids: [],
        count: 0,
      });
    }

    const group = urlGroups.get(normalizedUrl)!;
    if (!group.urls.includes(article.url)) {
      group.urls.push(article.url);
      group.ids.push(article.id);
      group.count++;
    }
  }

  // Find groups with multiple entries
  const duplicates: DuplicateGroup[] = [];
  for (const group of urlGroups.values()) {
    if (group.count > 1) {
      duplicates.push(group);
    }
  }

  if (duplicates.length === 0) {
    console.log('✓ No potential duplicates found by URL normalization.\n');
  } else {
    console.log(`Found ${duplicates.length} potential duplicate group(s) by URL:\n`);
    for (const dup of duplicates) {
      console.log(`  Canonical URL: ${dup.canonicalUrl}`);
      console.log(`  Variations found: ${dup.urls.length}`);
      console.log(`  IDs: ${dup.ids.join(', ')}`);
      console.log(`  URLs:`);
      for (const url of dup.urls) {
        console.log(`    - ${url}`);
      }
      console.log('');
    }
  }

  // Check for similar titles (potential content duplicates)
  console.log('\n=== Checking for similar titles ===\n');

  const titleMap = new Map<string, number[]>();
  for (const article of articles) {
    const normalizedTitle = article.title.toLowerCase().trim().substring(0, 100);
    if (!titleMap.has(normalizedTitle)) {
      titleMap.set(normalizedTitle, []);
    }
    titleMap.get(normalizedTitle)!.push(article.id);
  }

  const exactTitleDuplicates: Array<{ title: string; ids: number[]; count: number }> = [];
  for (const [title, ids] of titleMap.entries()) {
    if (ids.length > 1) {
      exactTitleDuplicates.push({ title, ids, count: ids.length });
    }
  }

  if (exactTitleDuplicates.length === 0) {
    console.log('✓ No exact title duplicates found.\n');
  } else {
    console.log(`Found ${exactTitleDuplicates.length} exact title duplicate(s):\n`);
    for (const dup of exactTitleDuplicates.slice(0, 10)) {
      console.log(`  Title: "${dup.title}"`);
      console.log(`  Count: ${dup.count}, IDs: ${dup.ids.join(', ')}`);
      console.log('');
    }
    if (exactTitleDuplicates.length > 10) {
      console.log(`  ... and ${exactTitleDuplicates.length - 10} more.\n`);
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total articles: ${articles.length}`);
  console.log(`Potential URL duplicates: ${duplicates.length} group(s)`);
  console.log(`Exact title duplicates: ${exactTitleDuplicates.length} group(s)`);

  // Cleanup test script
  await db.destroy();
  process.exit(0);
}

checkDuplicates().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
