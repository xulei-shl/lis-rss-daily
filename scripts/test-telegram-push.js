/**
 * 手动测试 Telegram 推送
 */

import { getTelegramNotifier } from '../src/telegram/index.ts';

const log = console;

async function testTelegramPush() {
  const userId = 1;

  try {
    console.log('🧪 Testing Telegram journal all summary push...');
    console.log('User ID:', userId);
    console.log('Date: 2026-03-16');

    const result = await getTelegramNotifier().sendJournalAllSummary(userId, {
      date: '2026-03-16',
      type: 'journal_all',
      totalArticles: 3,
      summary: '📝 测试推送内容\n\n这是一个测试消息，用于验证 Telegram 推送功能是否正常。\n\n如果收到这条消息，说明推送功能正常。',
      articlesByType: {
        journal: 3,
        blog: 0,
        news: 0,
      },
    });

    console.log('✅ Push result:', result);

    if (result) {
      console.log('🎉 Telegram push successful!');
    } else {
      console.log('❌ Telegram push returned false');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testTelegramPush().then(() => {
  console.log('✅ Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
