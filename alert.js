import { config } from './config.js';

export async function sendAlert(match) {
  const text = formatMatch(match);
  console.log(`\n🎯 MATCH: ${text}\n`);

  const jobs = [];

  if (config.discordWebhookUrl) {
    jobs.push(
      fetch(config.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🎯 **StonkFun reward match**\n${text}` }),
      }).catch((err) => console.error('Discord alert failed:', err.message))
    );
  }

  if (config.telegramBotToken && config.telegramChatId) {
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    jobs.push(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text: `🎯 StonkFun reward match\n${text}`,
        }),
      }).catch((err) => console.error('Telegram alert failed:', err.message))
    );
  }

  await Promise.all(jobs);
}

function formatMatch(match) {
  const { mint, symbol, name, pendingRewardsUsd, holders, volumeUsd } = match;
  const label = symbol || name || mint;
  return [
    `${label} (${mint})`,
    `pending rewards: $${pendingRewardsUsd.toFixed(2)}`,
    `holders: ${holders}`,
    `volume: $${volumeUsd.toFixed(2)}`,
    `https://www.stonkfun.xyz/token/${mint}`,
  ].join('\n');
}
