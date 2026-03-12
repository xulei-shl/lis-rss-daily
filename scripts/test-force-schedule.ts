import 'dotenv/config';

const forceOnSchedule = process.env.RSS_FETCH_FORCE_ON_SCHEDULE === 'true';
console.log('RSS_FETCH_FORCE_ON_SCHEDULE:', process.env.RSS_FETCH_FORCE_ON_SCHEDULE);
console.log('forceOnSchedule (parsed):', forceOnSchedule);
console.log('Type:', typeof forceOnSchedule);
