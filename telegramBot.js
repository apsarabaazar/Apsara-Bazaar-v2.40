// telegramBot.js
const TelegramBot = require('node-telegram-bot-api');

// Create a singleton instance of the bot
let botInstance;

function getBot() {
    if (!botInstance) {
        botInstance = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    }
    return botInstance;
}

// Export the singleton instance
module.exports = getBot();