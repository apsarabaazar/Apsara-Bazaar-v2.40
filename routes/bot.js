const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { TELEGRAM_BOT_TOKEN } = process.env;

const Post = require('../models/Post');
const Image = require('../models/Image');
const User = require('../models/User')

const multer = require('multer');
const { pipeline } = require("stream");
const { sendEmail } = require('../mailer');
const upload = multer().array('images', 10);
const cron = require('node-cron');


//const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const Admins = ["trickytejas", "raghav_0308"];

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userUsername = msg.from.username;

    // Ensure only allowed admins can use this command
    if (!Admins.includes(userUsername)) {
        bot.sendMessage(chatId, "You don't have permission to use this bot.");
        return;
    }
    bot.sendMessage(
        chatId,
        `Welcome! Admin,To Apsara Bazaar Manager`,
    );
});

// Temporary storage for article data (in-memory)
const articleStorage = {};

bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const userUsername = msg.from.username;

    if (!Admins.includes(userUsername)) {
        await bot.sendMessage(chatId, "You don't have permission to use this bot.");
        return;
    }

    const fileId = msg.document.file_id;

    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await axios.get(fileLink);

        const tempFilePath = path.join(__dirname, 'temp.txt');
        fs.writeFileSync(tempFilePath, response.data, 'utf-8');

        const fileContent = fs.readFileSync(tempFilePath, 'utf-8');
        const articleRegex = /<article.*?>.*?<\/article>/gs;
        const articles = fileContent.match(articleRegex);

        if (articles && articles.length > 0) {
            for (const [index, article] of articles.entries()) {
                try {
                    const urlRegex = /(https?:\/\/[^\s"']+\.(gif|jpg|jpeg|png|webp|mp4))/gi;
                    const urls = article.match(urlRegex);
                    const lastUrl = urls ? urls[urls.length - 1] : null;

                    const ariaLabelRegex = /aria-label="([^"]+)"/gi;
                    const ariaLabels = [...article.matchAll(ariaLabelRegex)].map(match => match[1]);
                    const lastAriaLabel = ariaLabels.length > 0 ? ariaLabels[ariaLabels.length - 1] : "N/A";

                    let fileId;
                    if (lastUrl) {
                        try {
                            // Save the article data in storage
                            const uniqueId = `article_${index + 1}`;
                            articleStorage[uniqueId] = { title: lastAriaLabel, mediaUrl: lastUrl };

                            // Create inline keyboard
                            const inlineKeyboard = {
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            {
                                                text: "Post",
                                                callback_data: uniqueId, // Use uniqueId as callback_data
                                            },
                                        ],
                                    ],
                                },
                            };

                            // Send the media with inline keyboard
                            const sentMessage = await bot.sendPhoto(chatId, lastUrl, {
                                caption: `Article ${index + 1}:\n"${lastAriaLabel}"`,
                                ...inlineKeyboard, // Add the inline keyboard here
                            });

                            // Store file ID after sending
                            fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
                            articleStorage[uniqueId].fileId = fileId; // Update storage with file ID
                        } catch (mediaError) {
                            console.error(`Error sending media for Article ${index + 1}`);
                            await bot.sendMessage(chatId, `Article ${index + 1}:\n${lastAriaLabel}\nMedia URL: ${lastUrl}`);
                            continue;
                        }
                    } else {
                        await bot.sendMessage(chatId, `Article ${index + 1}:\n${lastAriaLabel}\nNo media URL found`);
                        continue;
                    }
                } catch (err) {
                    console.error(`Error processing Article ${index + 1}:`, err);
                    await bot.sendMessage(chatId, `Error processing Article ${index + 1}. Skipping...`);
                }

                await new Promise(resolve => setTimeout(resolve, 800));
            }
        } else {
            await bot.sendMessage(chatId, "No <article> tags found in the file.");
        }

        fs.unlinkSync(tempFilePath);
    } catch (error) {
        console.error("Error processing the file:", error);
        await bot.sendMessage(chatId, `An error occurred while processing the file: ${error.message}`);
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const uniqueId = query.data;

    if (articleStorage[uniqueId]) {
        const { fileId, title } = articleStorage[uniqueId];

        try {
            // Step 1: Create the post in the Post collection
            const post = new Post({
                title: title,
                bodyText: "Ownership transferred to Apsara Bazaar",
                author: "apsara_bazaar",
                createdAt: new Date(),
                tags: ["recent", "Bazaar"],
            });

            await post.save();
            const postId = post._id; // Fetch the generated post ID

            // Step 2: Send the image to the private Telegram group
            const response = await bot.sendPhoto(
                process.env.TELEGRAM_GROUP_ID, // Replace with your private group ID
                fileId,
                {
                    caption: `Post ID: ${postId}`, // Include the post ID as caption
                }
            );

            const highestResolutionPhotoId = response.photo[response.photo.length - 1].file_id;
            const messageId = response.message_id;

            // Step 3: Create the record in the Images collection
            const imageDoc = new Image({
                postId: postId,
                fileId: highestResolutionPhotoId,
                caption: messageId, // Store the Telegram message ID in the caption field
            });

            await imageDoc.save();

            // Acknowledge the callback query
            await bot.answerCallbackQuery(query.id, { text: "Post created successfully!" });

            // Notify the admin in the same chat
            await bot.sendMessage(chatId, `Post created:\nTitle: ${title}\nPost ID: ${postId}`);
        } catch (error) {
            console.error("Error during database operation:", error);

            // Acknowledge the callback query with an error message
            await bot.answerCallbackQuery(query.id, { text: "Failed to create post. Please try again." });

            // Notify the admin in the chat
            await bot.sendMessage(chatId, `Error creating post:\n${error.message}`);
        }
    } else {
        await bot.answerCallbackQuery(query.id, { text: "Invalid article data." });
        await bot.sendMessage(chatId, "Error: Could not retrieve article data.");
    }
});



// Add the array of target profiles
const targetProfiles = [
    'imouniroy',
    'kiaraaliaadvani',
    'dishapatani',
    'tamannaahspeaks',
    'rakulpreet',
    'iamsandeepadhar',
    'anveshi25',
    'kavyathapar20',
    'avneetkaur_13',
    'anushkasen0408',
    'samantharuthprabhuoffl'
];

const { chromium } = require('playwright');

// Instagram Fetch----------------------------------------------------------------------------------------------------------------------------


// bot.onText(/\/fetch/, async (msg) => {
//     const chatId = msg.chat.id;
//     const userUsername = msg.from.username;

//     if (!Admins.includes(userUsername)) {
//         await bot.sendMessage(chatId, "You don't have permission to use this command.");
//         return;
//     }

//     try {
//         const targetProfile = 'kiaraaliaadvani';
//         const instaUsername = 'a_man0421';
//         const instaPassword = 'Tejas@123';

//         console.log("Launching browser...");
//         const browser = await chromium.launch({
//   headless: false,
//   slowMo: 100,
//   executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
// });
//         const context = await browser.newContext({
//             userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 263.1.0.17.109 (iPhone13,2; iOS 15_4_1; en_IN; en-IN; scale=3.00; 1170x2532; 420906785)',
//             viewport: { width: 700, height: 780 }
//         });

//         const page = await context.newPage();

//         // Login Process
//         await page.goto('https://www.instagram.com/accounts/login/', {
//             waitUntil: 'networkidle',
//             timeout: 60000
//         });

//         await page.waitForSelector('input[name="username"]');
//         await page.type('input[name="username"]', instaUsername, { delay: 100 });
//         await page.type('input[name="password"]', instaPassword, { delay: 100 });
//         await page.click('button[type="submit"]');

//         await page.waitForSelector('svg[aria-label="Home"]', { timeout: 60000 });

//         await handleDialog(page, 'button:has-text("Not Now")');
//         await handleDialog(page, 'button:has-text("Not Now")');

//         await page.goto(`https://www.instagram.com/${targetProfile}/`, {
//             waitUntil: 'networkidle',
//             timeout: 60000
//         });

//         await page.waitForSelector('main section', { timeout: 60000 });

//         const seenPosts = new Set();

//         let scrollCount = 0;
//         const maxScrolls = 1;

//         while (scrollCount < maxScrolls) {
//             // Get new posts and update seenPosts
//             console.log("trying to fetch on scroll "+scrollCount)
//             const newPosts = await fetchPosts(page, seenPosts);

//             for (const post of newPosts) {
//                 //console.log(post.imageUrl);
//                 await bot.sendPhoto(chatId, post.imageUrl, {
//                     caption: post.caption
//                 });
//                 await page.waitForTimeout(1500);
//             }

//             //if (newPosts.length === 0) break;

//             await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
//             await page.waitForTimeout(6000);

//             scrollCount++;
//         }

//         //await browser.close();
//         await bot.sendMessage(chatId, `Fetched all posts from @${targetProfile}`);

//     } catch (error) {
//         console.error('Error:', error);
//         await bot.sendMessage(chatId, `Error: ${error.message}`);
//     }
// });

// async function handleDialog(page, selector) {
//     try {
//         const btn = await page.waitForSelector(selector, { timeout: 3000 });
//         await btn.click();
//         await page.waitForTimeout(1000);
//     } catch (e) {
//         // Dialog not found
//     }
// }

// async function fetchPosts(page, seenPosts) {
//     const result = await page.evaluate((seenUrlsArray) => {
//         const posts = [];
//         const newUrls = [];
//         const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000); // 2 days ago in milliseconds

//         document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach(link => {
//             const img = link.querySelector('img');
//             if (!img) return; // Skip if no image

//             const postUrl = link.href;
//             const caption = img.alt || '';

//             // Extract date from caption: "on Month DD, YYYY."
//             const dateMatch = caption.match(/on (\w+ \d{1,2}, \d{4})\./i);
//             if (!dateMatch) return; // Skip if no date found

//             try {
//                 const postDate = new Date(dateMatch[1]);
//                 if (isNaN(postDate.getTime())) return; // Skip invalid date

//                 // Check if the post is new and within 2 days
//                 if (!seenUrlsArray.includes(postUrl) && postDate >= twoDaysAgo) {
//                     posts.push({
//                         url: postUrl,
//                         imageUrl: img.src,
//                         caption: caption
//                     });
//                     newUrls.push(postUrl);
//                 }
//             } catch (e) {
//                 console.error("Invalid Format: ", e);
//                 return; // Skip on error
//             }
//         });

//         return { posts, newUrls };
//     }, Array.from(seenPosts));

//     // Update seen posts
//     result.newUrls.forEach(url => seenPosts.add(url));
//     return result.posts;
// }


//Telegram Fetch-----------------------------------------------------------------------------------------------------------------------------
bot.onText(/\/fetch/, async (msg) => {
    const chatId = msg.chat.id;
    const userUsername = msg.from.username;

    if (!Admins.includes(userUsername)) {
        await bot.sendMessage(chatId, "You don't have permission to use this command.");
        return;
    }

    try {
        console.log("Launching browser...");
        const browser = await chromium.launchPersistentContext('C:\\Users\\Asus\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Default', {
            headless: false, // Keep UI visible
            slowMo: 100,
            executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        });
        
        //const context = await browser.newContext();
        //const page = await context.newPage();
        const page = await browser.newPage();  // ✅ Use browser directly

        await page.goto('https://web.telegram.org/', { waitUntil: 'networkidle', timeout: 60000 });
        
        // Wait for login (manual input required if not logged in)
        await page.waitForSelector('input[type="text"]', { timeout: 60000 }).catch(() => {});
        
        // Navigate to the channel
        await page.goto('https://web.telegram.org/k/#@desiirandiyan', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForSelector('.message', { timeout: 60000 });
        
        // Fetch last 5 posts
        const messages = await page.evaluate(() => {
            const posts = [];
            document.querySelectorAll('.message').forEach((msg, index) => {
                if (index < 30) {
                    const text = msg.querySelector('.text')?.innerText || 'No text';
                    const image = msg.querySelector('img')?.src || null;
                    posts.push({ text, image });
                }
            });
            return posts;
        });

        // Send messages to user
        for (const post of messages) {
            if (post.image) {
                await bot.sendPhoto(chatId, post.image, { caption: post.text });
            } else {
                await bot.sendMessage(chatId, post.text);
            }
            await page.waitForTimeout(1500);
        }

        await bot.sendMessage(chatId, `Fetched last 5 posts from @desirand.`);
        await browser.close();
    } catch (error) {
        console.error('Error:', error);
        await bot.sendMessage(chatId, `Error: ${error.message}`);
    }
});












