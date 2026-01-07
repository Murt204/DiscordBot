const { Client, GatewayIntentBits, Collection, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType, PermissionFlagsBits, AttachmentBuilder, ActivityType } = require('discord.js');
const Jimp = require('jimp');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { spawn } = require('child_process');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

// Pending verification codes: code -> { robloxId, timestamp }
const pendingCodes = new Collection();
// Completed verifications: code -> robloxId (short term storage for polling)
const completedCodes = new Collection();
// API Server
const app = express();
app.use(bodyParser.json());
const API_PORT = process.env.PORT || 3000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Config file path
const CONFIG_PATH = './config.json';

// Load config from file
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Failed to load config:', error);
    }
    return { guilds: {}, users: {} };
}

// Save config to file
function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Failed to save config:', error);
    }
}

// Get guild config (creates default if not exists)
function getGuildConfig(guildId) {
    if (!config.guilds[guildId]) {
        config.guilds[guildId] = {
            memberCountChannel: null,
            welcomeConfig: null,
            botColor: 0x5865F2,
            autoJoinRole: null,
            ticketConfig: null,
            levelRoles: [],
            gameId: null,
            playerCountChannel: null,
            logsChannel: null,
            warns: {}
        };
        saveConfig();
    }
    return config.guilds[guildId];
}

// Load config on startup
let config = loadConfig();
if (!config.users) {
    config.users = {};
    saveConfig();
}

// Global linked users wrapper
const linkedAccounts = {
    get: (discordId) => config.users[discordId],
    set: (discordId, robloxId) => { config.users[discordId] = robloxId; saveConfig(); },
    has: (discordId) => !!config.users[discordId]
};

// Backwards-compatible wrappers that use the config file
const welcomeConfigs = {
    get: (guildId) => getGuildConfig(guildId).welcomeConfig,
    set: (guildId, value) => { getGuildConfig(guildId).welcomeConfig = value; saveConfig(); },
    delete: (guildId) => { getGuildConfig(guildId).welcomeConfig = null; saveConfig(); },
    has: (guildId) => !!getGuildConfig(guildId).welcomeConfig
};

const botColors = {
    get: (guildId) => getGuildConfig(guildId).botColor,
    set: (guildId, value) => { getGuildConfig(guildId).botColor = value; saveConfig(); }
};

const autoJoinRoles = {
    get: (guildId) => getGuildConfig(guildId).autoJoinRole,
    set: (guildId, value) => { getGuildConfig(guildId).autoJoinRole = value; saveConfig(); },
    delete: (guildId) => { getGuildConfig(guildId).autoJoinRole = null; saveConfig(); },
    has: (guildId) => !!getGuildConfig(guildId).autoJoinRole
};

const ticketConfigs = {
    get: (guildId) => getGuildConfig(guildId).ticketConfig,
    set: (guildId, value) => { getGuildConfig(guildId).ticketConfig = value; saveConfig(); },
    has: (guildId) => !!getGuildConfig(guildId).ticketConfig
};

const levelRoles = {
    get: (guildId) => getGuildConfig(guildId).levelRoles || [],
    set: (guildId, value) => { getGuildConfig(guildId).levelRoles = value; saveConfig(); }
};

const gameConfigs = {
    get: (guildId) => getGuildConfig(guildId).gameId,
    set: (guildId, value) => { getGuildConfig(guildId).gameId = value; saveConfig(); }
};

const memberCountChannels = {
    get: (guildId) => getGuildConfig(guildId).memberCountChannel,
    set: (guildId, value) => { getGuildConfig(guildId).memberCountChannel = value; saveConfig(); },
    delete: (guildId) => { getGuildConfig(guildId).memberCountChannel = null; saveConfig(); },
    has: (guildId) => !!getGuildConfig(guildId).memberCountChannel
};

const playerCountChannels = {
    get: (guildId) => getGuildConfig(guildId).playerCountChannel,
    set: (guildId, value) => { getGuildConfig(guildId).playerCountChannel = value; saveConfig(); },
    delete: (guildId) => { getGuildConfig(guildId).playerCountChannel = null; saveConfig(); },
    has: (guildId) => !!getGuildConfig(guildId).playerCountChannel
};

const logChannels = {
    get: (guildId) => getGuildConfig(guildId).logsChannel,
    set: (guildId, value) => { getGuildConfig(guildId).logsChannel = value; saveConfig(); },
    delete: (guildId) => { getGuildConfig(guildId).logsChannel = null; saveConfig(); },
    has: (guildId) => !!getGuildConfig(guildId).logsChannel
};

const guildWarns = {
    get: (guildId, userId) => {
        const gConfig = getGuildConfig(guildId);
        if (!gConfig.warns) gConfig.warns = {};
        return gConfig.warns[userId] || [];
    },
    add: (guildId, userId, warning) => {
        const gConfig = getGuildConfig(guildId);
        if (!gConfig.warns) gConfig.warns = {};
        if (!gConfig.warns[userId]) gConfig.warns[userId] = [];
        gConfig.warns[userId].push(warning);
        saveConfig();
    },
    clear: (guildId, userId) => {
        const gConfig = getGuildConfig(guildId);
        if (gConfig.warns && gConfig.warns[userId]) {
            delete gConfig.warns[userId];
            saveConfig();
        }
    }
};

// Runtime-only storage (not persisted - tickets and XP)
const activeTickets = new Collection();
const closedTickets = new Collection();
const userLevels = new Collection();

client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);

    // Set bot presence
    client.user.setPresence({
        activities: [{ name: 'Brainrot Runners', type: ActivityType.Playing }],
        status: 'online',
    });

    // Update member count for all guilds on startup
    for (const guild of client.guilds.cache.values()) {
        await updateMemberCount(guild);
        await updatePlayerCount(guild);
    }

    // Start loops
    setInterval(async () => {
        for (const guild of client.guilds.cache.values()) {
            await updatePlayerCount(guild);
        }
    }, 5 * 60 * 1000); // Check every 5 mins

    // --- API SERVER FOR ROBLOX ---

    // 1. Roblox sends generated code here
    app.post('/api/code', (req, res) => {
        const { code, robloxId } = req.body;
        console.log(`Received code ${code} for Roblox ID ${robloxId}`);
        if (code && robloxId) {
            pendingCodes.set(code, { robloxId, timestamp: Date.now() });
            // Clean up old codes (optional, but good practice)
            setTimeout(() => pendingCodes.delete(code), 300000); // Expires in 5 mins
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Missing code or robloxId' });
        }
    });

    // 2. Roblox polls this to check if user verified
    app.get('/api/status/:code', (req, res) => {
        const code = req.params.code;
        const linkedId = completedCodes.get(code);

        if (linkedId) {
            res.json({ verified: true, robloxId: linkedId });
        } else {
            res.json({ verified: false });
        }
    });

    app.listen(API_PORT, () => {
        console.log(`🌐 API Server listening on port ${API_PORT}`);
    });
});

// Update member count when members join/leave
client.on(Events.GuildMemberAdd, async (member) => {
    await updateMemberCount(member.guild);
    await assignAutoJoinRole(member);
    await sendWelcomeMessage(member);
});

client.on(Events.GuildMemberRemove, async (member) => {
    await updateMemberCount(member.guild);
});

// Handle XP gain from messages
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;



    // Award XP for regular messages
    await awardXP(message);
});

// Handle slash commands (public commands only)
client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'ticket') {
            await handleTicketSlash(interaction);
        } else if (commandName === 'close') {
            await handleCloseTicketSlash(interaction);
        } else if (commandName === 'reopen') {
            await handleReopenTicketSlash(interaction);
        } else if (commandName === 'delete') {
            await handleDeleteTicketSlash(interaction);
        } else if (commandName === 'transcript') {
            await handleTranscriptSlash(interaction);
        } else if (commandName === 'level') {
            await handleLevelSlash(interaction);
        } else if (commandName === 'leaderboard') {
            await handleLeaderboardSlash(interaction);
        } else if (commandName === 'gamestats') {
            await handleGameStatsSlash(interaction);
        } else if (commandName === 'whois') {
            await handleWhoisSlash(interaction);
        } else if (commandName === 'link') {
            await handleLinkSlash(interaction);
        } else if (commandName === 'unlink') {
            await handleUnlinkSlash(interaction);
        } else if (commandName === 'help') {
            await handleHelpSlash(interaction);
        } else if (commandName === 'ban') {
            await handleBanSlash(interaction);
        } else if (commandName === 'kick') {
            await handleKickSlash(interaction);
        } else if (commandName === 'warn') {
            await handleWarnSlash(interaction);
        }
    } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('leaderboard_')) {
            await handleLeaderboardPagination(interaction);
        } else {
            await handleButtonInteraction(interaction);
        }
    }
});

// Handle prefix commands (dev/admin commands)
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'commands') {
        await handleCommandsPanel(message);
    } else if (command === 'setcolor') {
        await handleSetColorPrefix(message, args);
    } else if (command === 'setautorole') {
        await handleSetAutoRolePrefix(message, args);
    } else if (command === 'removeautorole') {
        await handleRemoveAutoRolePrefix(message);
    } else if (command === 'ticketsetup') {
        await handleTicketSetupPrefix(message, args);
    } else if (command === 'ticketcategory') {
        await handleTicketCategoryPrefix(message, args);
    } else if (command === 'ticketrole') {
        await handleTicketRolePrefix(message, args);
    } else if (command === 'ticketpanel') {
        await handleTicketPanelPrefix(message, args);
    } else if (command === 'ticketconfig') {
        await handleTicketConfigPrefix(message);
    } else if (command === 'ticketdisable') {
        await handleTicketDisablePrefix(message);
    } else if (command === 'tickettranscript') {
        await handleTicketTranscriptPrefix(message, args);
    } else if (command === 'setmembercount') {
        await handleSetMemberCountPrefix(message, args);
    } else if (command === 'removemembercount') {
        await handleRemoveMemberCountPrefix(message);
    } else if (command === 'setplayercount') {
        await handleSetPlayerCountPrefix(message, args);
    } else if (command === 'removeplayercount') {
        await handleRemovePlayerCountPrefix(message);
    } else if (command === 'welcomesetup') {
        await handleWelcomeSetupPrefix(message, args);
    } else if (command === 'welcomemessage') {
        await handleWelcomeMessagePrefix(message, args);
    } else if (command === 'welcomeembed') {
        await handleWelcomeEmbedPrefix(message, args);
    } else if (command === 'welcometest') {
        await handleWelcomeTestPrefix(message);
    } else if (command === 'welcomeconfig') {
        await handleWelcomeConfigPrefix(message);
    } else if (command === 'welcomedisable') {
        await handleWelcomeDisablePrefix(message);
    } else if (command === 'restart') {
        await handleRestartPrefix(message);
    } else if (command === 'setlevelrole') {
        await handleSetLevelRolePrefix(message, args);
    } else if (command === 'removelevelrole') {
        await handleRemoveLevelRolePrefix(message, args);
    } else if (command === 'levelroles') {
        await handleListLevelRolesPrefix(message);
    } else if (command === 'setgameid') {
        await handleSetGameIdPrefix(message, args);
    } else if (command === 'warns') {
        await handleWarnsPrefix(message, args);
    }
});

async function updateMemberCount(guild) {
    const guildConfig = getGuildConfig(guild.id);
    const channelId = guildConfig.memberCountChannel;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
        // Channel was deleted, remove from our tracking
        guildConfig.memberCountChannel = null;
        saveConfig();
        return;
    }

    try {
        const memberCount = guild.memberCount;
        const newName = `Members: ${memberCount}`;

        if (channel.name !== newName) {
            await channel.setName(newName);
            console.log(`Updated member count for ${guild.name}: ${memberCount}`);
        }
    } catch (error) {
        console.error(`Failed to update member count for ${guild.name}:`, error);
    }
}

async function updatePlayerCount(guild) {
    const guildConfig = getGuildConfig(guild.id);
    const channelId = guildConfig.playerCountChannel;
    const gameId = guildConfig.gameId;

    if (!channelId || !gameId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
        // Channel was deleted
        guildConfig.playerCountChannel = null;
        saveConfig();
        return;
    }

    try {
        const playerCount = await getRobloxPlayerCount(gameId);
        if (playerCount === null) return;

        const newName = `Playing: ${playerCount.toLocaleString()}`;

        if (channel.name !== newName) {
            await channel.setName(newName);
            console.log(`Updated player count for ${guild.name}: ${playerCount}`);
        }
    } catch (error) {
        console.error(`Failed to update player count for ${guild.name}:`, error);
        // Rate limit handling - if we hit rate limits, just wait for next loop
    }
}

async function getRobloxPlayerCount(gameId) {
    try {
        // Try treating it as a Universe ID first (preferred)
        // API: https://games.roblox.com/v1/games?universeIds=...
        let response = await axios.get(`https://games.roblox.com/v1/games?universeIds=${gameId}`);

        if (response.data && response.data.data && response.data.data.length > 0) {
            return response.data.data[0].playing;
        }

        // If that failed or returned nothing, it might be a Place ID.
        // Convert Place ID -> Universe ID
        // API: https://games.roblox.com/v1/games/multiget-place-details?placeIds=...
        const headers = {};
        if (process.env.ROBLOX_COOKIE) {
            headers['Cookie'] = process.env.ROBLOX_COOKIE;
        }

        response = await axios.get(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${gameId}`, {
            headers: headers
        });

        if (response.data && response.data.length > 0) {
            const universeId = response.data[0].universeId;
            // Now fetch count with the correct Universe ID
            const gameResponse = await axios.get(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
            if (gameResponse.data && gameResponse.data.data && gameResponse.data.data.length > 0) {
                return gameResponse.data.data[0].playing;
            }
        }

        return null; // Could not find game
    } catch (error) {
        console.error(`Error fetching Roblox player count for ID ${gameId}:`, error.message);
        return null;
    }
}

async function handleSetPlayerCountPrefix(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    if (!config.guilds[message.guild.id].gameId) {
        return message.reply('❌ No Game ID set! Please set a game ID first using `!setgameid <id>`.');
    }

    // Default to the channel the command was used in if no channel mentioned
    let targetChannel = message.channel;

    if (args.length > 0) {
        // Check if an ID was pasted
        if (args[0].match(/^\d+$/) && !args[0].startsWith('<#')) {
            // This looks like a channel ID
            const chCallback = message.guild.channels.cache.get(args[0]);
            if (chCallback) targetChannel = chCallback;
        } else {
            // Check mentions
            const channelId = args[0].replace(/[<#>]/g, '');
            const chCallback = message.guild.channels.cache.get(channelId);
            if (chCallback) targetChannel = chCallback;
        }
    }

    // It should be a voice channel ideally, but text works too (locked)
    // Common practice is Voice Channel so users can't type in it easily and it looks clean
    if (targetChannel.type !== 2) { // 2 = Voice Channel
        // Warn but allow (or just create one?)
        // Let's just warn
        // return message.reply('❌ Please use a Voice Channel for the counter (it looks better!). Create a voice channel and mention it: `!setplayercount #channel`');
    }

    const guildConfig = getGuildConfig(message.guild.id);
    guildConfig.playerCountChannel = targetChannel.id;
    saveConfig();

    await message.reply(`✅ Player count channel set to **${targetChannel.name}**! It will update every 5 minutes.`);

    // Trigger immediate update
    await updatePlayerCount(message.guild);
}

async function handleRemovePlayerCountPrefix(message) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    const guildConfig = getGuildConfig(message.guild.id);
    if (!guildConfig.playerCountChannel) {
        return message.reply('❌ No player count channel is currently set.');
    }

    guildConfig.playerCountChannel = null;
    saveConfig();

    await message.reply('✅ Player count channel disabled.');
}

async function handleSetMemberCount(interaction) {
    if (!interaction.member.permissions.has('ManageChannels')) {
        return interaction.reply({
            content: '❌ You need the "Manage Channels" permission to use this command.',
            ephemeral: true
        });
    }

    const channel = interaction.options.getChannel('channel');

    if (channel.type !== 2) { // 2 = Voice Channel
        return interaction.reply({
            content: '❌ Please select a voice channel for the member count.',
            ephemeral: true
        });
    }

    const guildConfig = getGuildConfig(interaction.guild.id);
    guildConfig.memberCountChannel = channel.id;
    saveConfig();
    await updateMemberCount(interaction.guild);

    await interaction.reply({
        content: `✅ Member count channel set to ${channel}! The channel name will update automatically.`,
        ephemeral: true
    });
}

async function handleRemoveMemberCount(interaction) {
    if (!interaction.member.permissions.has('ManageChannels')) {
        return interaction.reply({
            content: '❌ You need the "Manage Channels" permission to use this command.',
            ephemeral: true
        });
    }

    const guildConfig = getGuildConfig(interaction.guild.id);
    if (!guildConfig.memberCountChannel) {
        return interaction.reply({
            content: '❌ No member count channel is currently set.',
            ephemeral: true
        });
    }

    guildConfig.memberCountChannel = null;
    saveConfig();

    await interaction.reply({
        content: '✅ Member count channel removed. The channel name will no longer update automatically.',
        ephemeral: true
    });
}

// Welcome message functions
async function sendWelcomeMessage(member) {
    const config = welcomeConfigs.get(member.guild.id);
    if (!config || !config.enabled) return;

    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel) {
        // Channel was deleted, disable welcome messages
        welcomeConfigs.delete(member.guild.id);
        return;
    }

    try {
        const messageContent = replacePlaceholders(config.message, member);

        if (config.useEmbed) {
            const embed = new EmbedBuilder()
                .setTitle(replacePlaceholders(config.embedTitle, member))
                .setDescription(replacePlaceholders(config.embedDescription, member))
                .setColor(config.embedColor)
                .setThumbnail(config.showAvatar ? member.user.displayAvatarURL() : null)
                .setTimestamp(config.showTimestamp ? new Date() : null);

            if (config.embedFooter) {
                embed.setFooter({ text: replacePlaceholders(config.embedFooter, member) });
            }

            await channel.send({ content: messageContent || null, embeds: [embed] });
        } else {
            await channel.send(messageContent);
        }
    } catch (error) {
        console.error(`Failed to send welcome message in ${member.guild.name}:`, error);
    }
}

function replacePlaceholders(text, member) {
    if (!text) return '';

    return text
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.user.username)
        .replace(/{displayname}/g, member.displayName)
        .replace(/{server}/g, member.guild.name)
        .replace(/{membercount}/g, member.guild.memberCount)
        .replace(/{mention}/g, `<@${member.id}>`)
        .replace(/{tag}/g, member.user.tag);
}

function getDefaultWelcomeConfig() {
    return {
        enabled: true,
        channelId: null,
        message: 'Welcome to {server}, {user}! 🎉',
        useEmbed: false,
        embedTitle: 'Welcome to {server}!',
        embedDescription: 'Hey {user}, welcome to our awesome server! We now have {membercount} members.',
        embedColor: 0x00ff00,
        embedFooter: 'Enjoy your stay!',
        showAvatar: true,
        showTimestamp: true
    };
}

function getBotColor(guildId) {
    return getGuildConfig(guildId).botColor || 0x5865F2;
}

// Leveling system functions
function calculateLevel(xp) {
    return Math.floor(0.1 * Math.sqrt(xp));
}

function calculateXPForLevel(level) {
    return Math.pow(level / 0.1, 2);
}

function getRandomXP() {
    return Math.floor(Math.random() * 15) + 15; // 15-30 XP per message
}

async function awardXP(message) {
    if (message.author.bot) return;

    const guildId = message.guild.id;
    const userId = message.author.id;

    if (!userLevels.has(guildId)) {
        userLevels.set(guildId, new Map());
    }

    const guildLevels = userLevels.get(guildId);
    const userData = guildLevels.get(userId) || {
        xp: 0,
        level: 0,
        lastMessage: 0
    };

    // Cooldown to prevent spam (60 seconds)
    const now = Date.now();
    if (now - userData.lastMessage < 60000) return;

    const oldLevel = userData.level;
    userData.xp += getRandomXP();
    userData.level = calculateLevel(userData.xp);
    userData.lastMessage = now;

    guildLevels.set(userId, userData);

    // Check for level up
    if (userData.level > oldLevel) {
        await sendLevelUpMessage(message, userData.level);
        await assignLevelRole(message.member, userData.level);
    }
}

async function assignLevelRole(member, level) {
    const guildRoles = levelRoles.get(member.guild.id);
    if (!guildRoles) return;

    // Find role for this level
    const roleConfig = guildRoles.find(r => r.level === level);
    if (roleConfig) {
        const role = member.guild.roles.cache.get(roleConfig.roleId);
        if (role) {
            try {
                await member.roles.add(role);
            } catch (error) {
                console.error(`Failed to assign level role ${role.name}:`, error);
            }
        }
    }
}

async function sendLevelUpMessage(message, newLevel) {
    try {
        // Try to DM the user first (Strictly "Only user can see")
        await message.author.send(`🎉 Congratulations! You've reached **Level ${newLevel}** in **${message.guild.name}**!`);
    } catch (error) {
        // If DMs are blocked, send a temporary message in the channel and delete it after 5 seconds
        // This is the next best thing to "only user seeing", as it doesn't clutter the chat
        try {
            const reply = await message.reply(`🎉 Congratulations ${message.author}! You've reached **Level ${newLevel}**!`);
            setTimeout(() => {
                reply.delete().catch(() => { });
            }, 5000);
        } catch (e) {
            console.error('Failed to send fallback level up message:', e);
        }
    }
}

function createProgressBar(current, max, length = 20) {
    const progress = Math.round((current / max) * length);
    const empty = length - progress;

    const progressBar = '█'.repeat(progress) + '░'.repeat(empty);
    return `[${progressBar}]`;
}

const applyText = (canvas, text) => {
    const ctx = canvas.getContext('2d');
    let fontSize = 40; // Base font size

    do {
        ctx.font = `bold ${fontSize -= 2}px sans-serif`;
    } while (ctx.measureText(text).width > canvas.width - 300);

    return ctx.font;
};

async function createProfileCard(user, userData, rank, guild) {
    try {
        const width = 800;
        const height = 240; // Compact height as requested
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // --- BACKGROUND ---
        // Create a cool geometric/gradient background
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#1a1c2c');
        gradient.addColorStop(1, '#4a192c'); // Darker, richer gradient
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Add geometric shapes for texture
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(Math.random() * width, Math.random() * height, Math.random() * 100 + 50, 0, Math.PI * 2);
            ctx.fill();
        }

        // --- GLASS PANEL (Right Side) ---
        // Creates a semi-transparent area for the text to improve readability
        ctx.save();
        const panelX = 240;
        const panelY = 20;
        const panelW = width - 260; // 20px padding on right
        const panelH = height - 40; // 20px padding top/bottom
        const panelR = 25;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
        ctx.fill();

        // Glass border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // --- AVATAR ---
        // Draw the avatar on the left
        const avatarSize = 160;
        const avatarX = 40;
        const avatarY = (height - avatarSize) / 2;
        const avatarRadius = 80; // Full circle (160/2)

        // Drop shadow for avatar
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;

        // Load avatar
        try {
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
            const avatar = await loadImage(avatarUrl);

            // Draw circular avatar
            ctx.beginPath();
            ctx.arc(avatarX + avatarRadius, avatarY + avatarRadius, avatarRadius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.save();
            ctx.clip();
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();

            // Avatar Border
            ctx.shadowColor = 'transparent'; // Remove shadow for border
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.stroke();

        } catch (e) {
            console.error("Avatar missing", e);
            // Fallback circle
            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.arc(avatarX + avatarRadius, avatarY + avatarRadius, avatarRadius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // --- LEVEL BADGE (Overlapping bottom of avatar) ---
        const badgeW = 100;
        const badgeH = 30;
        const badgeX = avatarX + (avatarSize - badgeW) / 2;
        const badgeY = avatarY + avatarSize - 15;

        ctx.fillStyle = '#ff0055'; // Vibrant accent color
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 15);
        ctx.fill();

        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(`LVL ${userData.level}`, badgeX + badgeW / 2, badgeY + 21);

        // --- TEXT INFO (Inside Glass Panel) ---
        const textStartX = panelX + 30;
        const textStartY = panelY + 50;

        // Rank (Top Right of Panel)
        ctx.textAlign = 'right';
        const rankY = textStartY + 15; // Move rank down slightly

        ctx.font = 'bold 40px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText(`#${rank}`, panelX + panelW - 30, rankY);

        ctx.font = '16px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillText('RANK', panelX + panelW - 30, rankY - 35);

        // Username
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        // Use applyText for dynamic sizing
        ctx.font = applyText(canvas, user.username);
        ctx.fillText(user.username, textStartX, textStartY);

        // Tag/Handle
        ctx.font = '20px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(user.tag || user.username, textStartX, textStartY + 30);

        // --- PROGRESS BAR ---
        const currentLevelXP = calculateXPForLevel(userData.level);
        const nextLevelXP = calculateXPForLevel(userData.level + 1);
        const progressXP = userData.xp - currentLevelXP;
        const neededXP = nextLevelXP - currentLevelXP;
        const percentage = Math.min(1, Math.max(0, progressXP / neededXP));

        const barX = textStartX;
        const barY = textStartY + 80;
        const barWidth = panelW - 60; // 30px padding on each side
        const barHeight = 30;
        const barRadius = 15;

        // Bar Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barWidth, barHeight, barRadius);
        ctx.fill();

        // Bar Fill
        const barGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        barGradient.addColorStop(0, '#ff0055');
        barGradient.addColorStop(1, '#ff5599');

        ctx.fillStyle = barGradient;

        const fillWidth = Math.max(30, barWidth * percentage);

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(barX, barY, barWidth, barHeight, barRadius);
        ctx.clip();
        ctx.fillRect(barX, barY, fillWidth, barHeight);
        ctx.restore();

        // XP Text (Above Bar)
        ctx.textAlign = 'right';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${progressXP.toLocaleString()} / ${neededXP.toLocaleString()} XP`, barX + barWidth, barY - 10);

        // Percentage (Left)
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(`${(percentage * 100).toFixed(1)}%`, barX, barY - 10);

        return canvas.toBuffer();

    } catch (error) {
        console.error('Failed to create profile card with Canvas:', error);
        throw error;
    }
}

async function createSimpleProfileCard(user, userData, rank, guild) {
    // Simple fallback that creates a basic colored image with text
    try {
        const width = 800;
        const height = 300;
        const image = new Jimp(width, height, 0x36393FFF);

        // Get bot color
        const botColor = getBotColor(guild.id);
        const r = (botColor >> 16) & 255;
        const g = (botColor >> 8) & 255;
        const b = botColor & 255;

        // Add colored stripe
        const stripeColor = Jimp.rgbaToInt(r, g, b, 255);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < 10; y++) {
                image.setPixelColor(stripeColor, x, y);
                image.setPixelColor(stripeColor, x, height - 10 + y);
            }
        }

        // Load basic font with error handling
        let font, smallFont;
        try {
            font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
            smallFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
        } catch (fontError) {
            console.error('Failed to load fonts, using fallback:', fontError);
            // Use default font as fallback
            font = smallFont = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
        }

        // Helper function to create bold text effect for simple card
        const printBoldTextSimple = (font, x, y, text, offsetPixels = 1) => {
            const offsets = [
                [0, 0], [offsetPixels, 0], [0, offsetPixels], [offsetPixels, offsetPixels],
                [-offsetPixels, 0], [0, -offsetPixels], [-offsetPixels, -offsetPixels],
                [offsetPixels, -offsetPixels], [-offsetPixels, offsetPixels]
            ];

            offsets.forEach(([dx, dy]) => {
                image.print(font, x + dx, y + dy, text);
            });
        };

        // Add text - BOLD
        printBoldTextSimple(font, 50, 50, user.username, 1);
        printBoldTextSimple(smallFont, 50, 100, `Level ${userData.level} | Rank #${rank || '?'}`, 1);
        printBoldTextSimple(smallFont, 50, 130, `XP: ${userData.xp.toLocaleString()}`, 1);

        // Calculate progress
        const currentLevelXP = calculateXPForLevel(userData.level);
        const nextLevelXP = calculateXPForLevel(userData.level + 1);
        const progressXP = userData.xp - currentLevelXP;
        const neededXP = nextLevelXP - currentLevelXP;
        const progressPercent = Math.round((progressXP / neededXP) * 100);

        printBoldTextSimple(smallFont, 50, 160, `Progress: ${progressPercent}% to next level`, 1);
        printBoldTextSimple(smallFont, 50, 190, `${progressXP.toLocaleString()} / ${neededXP.toLocaleString()} XP`, 1);

        // Simple progress bar
        const barX = 50;
        const barY = 220;
        const barWidth = 700;
        const barHeight = 20;

        // Background
        const bgColor = Jimp.rgbaToInt(100, 100, 100, 255);
        for (let x = barX; x < barX + barWidth; x++) {
            for (let y = barY; y < barY + barHeight; y++) {
                image.setPixelColor(bgColor, x, y);
            }
        }

        // Fill
        const fillWidth = Math.floor(barWidth * (progressXP / neededXP));
        for (let x = barX; x < barX + fillWidth; x++) {
            for (let y = barY; y < barY + barHeight; y++) {
                image.setPixelColor(stripeColor, x, y);
            }
        }

        return await image.getBufferAsync(Jimp.MIME_PNG);
    } catch (error) {
        console.error('Failed to create simple profile card:', error);
        throw error;
    }
}

async function createLeaderboardCard(guild, pageUsers, currentPage, totalPages) {
    try {
        const width = 900;
        const rowHeight = 80;
        const headerHeight = 110;
        const height = headerHeight + (pageUsers.length * rowHeight) + 20;

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Background
        // Background (Matching Profile Card)
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#1a1c2c');
        gradient.addColorStop(1, '#4a192c');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Add geometric shapes
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(Math.random() * width, Math.random() * height, Math.random() * 100 + 50, 0, Math.PI * 2);
            ctx.fill();
        }

        // Header Text
        ctx.font = 'bold 45px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 10;
        ctx.fillText(`LEADERBOARD`, width / 2, 60);
        ctx.shadowBlur = 0;

        ctx.font = '20px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(`${guild.name} • Page ${currentPage}/${totalPages}`, width / 2, 90);

        // Draw Rows
        const startIndex = (currentPage - 1) * 10;

        for (let i = 0; i < pageUsers.length; i++) {
            const [userId, userData] = pageUsers[i];
            const rank = startIndex + i + 1;
            const y = headerHeight + (i * rowHeight);

            // Row Background (Glassmorphism Pills)
            ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.2)';
            ctx.beginPath();
            ctx.roundRect(20, y, width - 40, rowHeight - 10, 15);
            ctx.fill();

            // Rank Badge/Number
            ctx.textAlign = 'center';
            if (rank <= 3) {
                const color = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : '#CD7F32';
                ctx.shadowColor = color;
                ctx.shadowBlur = 10;
                ctx.fillStyle = color;
                ctx.font = 'bold 40px sans-serif';
                ctx.fillText(`#${rank}`, 70, y + 50);
                ctx.shadowBlur = 0;
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.font = 'bold 30px sans-serif';
                ctx.fillText(`#${rank}`, 70, y + 48);
            }

            // Fetch User
            let userDisplayName = 'Unknown User';
            let avatarUrl = null;
            try {
                const member = await guild.members.fetch(userId);
                userDisplayName = member.displayName;
                avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 128 });
            } catch (e) {
                // Keep defaults
            }

            // Avatar (Circular with Shadow)
            if (avatarUrl) {
                try {
                    const avatar = await loadImage(avatarUrl);
                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 5;
                    ctx.beginPath();
                    ctx.arc(140, y + 35, 25, 0, Math.PI * 2);
                    ctx.closePath();
                    ctx.save();
                    ctx.clip();
                    ctx.drawImage(avatar, 115, y + 10, 50, 50);
                    ctx.restore();

                    // Border
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();
                } catch (e) {
                    // Avatar load failed
                }
            } else {
                ctx.beginPath();
                ctx.arc(140, y + 35, 25, 0, Math.PI * 2);
                ctx.fillStyle = '#444444';
                ctx.fill();
            }

            // Username
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(userDisplayName, 200, y + 45);

            // Level & XP
            ctx.textAlign = 'right';

            // Level Pill
            ctx.fillStyle = '#ff0055';
            ctx.beginPath();
            const levelText = `LVL ${userData.level}`;
            const levelWidth = ctx.measureText(levelText).width + 30;
            ctx.roundRect(width - 40 - 150 - levelWidth, y + 20, levelWidth, 30, 15);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(levelText, width - 40 - 150 - 15, y + 41);

            // XP
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '18px sans-serif';
            ctx.fillText(`${userData.xp.toLocaleString()} XP`, width - 50, y + 42);
        }

        return canvas.toBuffer();
    } catch (error) {
        console.error('Failed to create leaderboard card:', error);
        throw error;
    }
}

async function assignAutoJoinRole(member) {
    const roleId = autoJoinRoles.get(member.guild.id);
    if (!roleId) return;

    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
        // Role was deleted, remove from our tracking
        autoJoinRoles.delete(member.guild.id);
        return;
    }

    try {
        await member.roles.add(role);
        console.log(`Assigned auto-join role "${role.name}" to ${member.user.tag} in ${member.guild.name}`);
    } catch (error) {
        console.error(`Failed to assign auto-join role to ${member.user.tag} in ${member.guild.name}:`, error);
    }
}

function getDefaultTicketConfig() {
    return {
        enabled: false,
        categoryId: null,
        supportRoleId: null,
        panelChannelId: null,
        ticketCounter: 0,
        closeAfterHours: 24,
        transcriptChannelId: null
    };
}

async function createTicket(guild, user, reason = 'No reason provided') {
    const config = ticketConfigs.get(guild.id);
    if (!config || !config.enabled) return null;

    const category = guild.channels.cache.get(config.categoryId);
    if (!category) return null;

    // Check if user already has an open ticket
    const guildTickets = activeTickets.get(guild.id) || new Map();
    const existingTicket = Array.from(guildTickets.values()).find(ticket => ticket.userId === user.id);
    if (existingTicket) {
        return { error: 'You already have an open ticket!', channelId: existingTicket.channelId };
    }

    config.ticketCounter++;
    ticketConfigs.set(guild.id, config);

    const ticketName = `ticket-${config.ticketCounter.toString().padStart(4, '0')}`;

    try {
        const ticketChannel = await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: category,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles
                    ],
                },
                {
                    id: guild.members.me.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ReadMessageHistory
                    ],
                }
            ],
        });

        // Add support role permissions if configured
        if (config.supportRoleId) {
            const supportRole = guild.roles.cache.get(config.supportRoleId);
            if (supportRole) {
                await ticketChannel.permissionOverwrites.create(supportRole, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true
                });
            }
        }

        // Store ticket info
        if (!activeTickets.has(guild.id)) {
            activeTickets.set(guild.id, new Map());
        }
        activeTickets.get(guild.id).set(ticketChannel.id, {
            channelId: ticketChannel.id,
            userId: user.id,
            reason: reason,
            createdAt: new Date(),
            ticketNumber: config.ticketCounter
        });

        // Send welcome message
        const botColor = getBotColor(guild.id);
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`🎫 Ticket #${config.ticketCounter.toString().padStart(4, '0')}`)
            .setDescription(`Hello ${user}! Thank you for creating a ticket.\n\n**Reason:** ${reason}\n\nOur support team will be with you shortly. Please describe your issue in detail.`)
            .setColor(botColor)
            .setFooter({ text: 'Use /close to close this ticket when resolved' })
            .setTimestamp();

        const closeButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('transcript_ticket')
                    .setLabel('Transcript')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📄')
            );

        await ticketChannel.send({
            content: config.supportRoleId ? `<@&${config.supportRoleId}>` : null,
            embeds: [welcomeEmbed],
            components: [closeButton]
        });

        return { success: true, channel: ticketChannel };
    } catch (error) {
        console.error('Failed to create ticket:', error);
        return { error: 'Failed to create ticket channel' };
    }
}

async function handleWelcomeSetup(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({
            content: '❌ You need the "Manage Server" permission to use this command.',
            ephemeral: true
        });
    }

    const channel = interaction.options.getChannel('channel');

    if (channel.type !== 0) { // 0 = Text Channel
        return interaction.reply({
            content: '❌ Please select a text channel for welcome messages.',
            ephemeral: true
        });
    }

    let config = welcomeConfigs.get(interaction.guild.id) || getDefaultWelcomeConfig();
    config.channelId = channel.id;
    config.enabled = true;

    welcomeConfigs.set(interaction.guild.id, config);

    await interaction.reply({
        content: `✅ Welcome messages will now be sent to ${channel}!\n\nUse other welcome commands to customize:\n• \`/welcomemessage\` - Set custom message\n• \`/welcomeembed\` - Configure embed settings\n• \`/welcometest\` - Test your welcome message\n• \`/welcomeconfig\` - View current settings`,
        ephemeral: true
    });
}

async function handleWelcomeMessage(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({
            content: '❌ You need the "Manage Server" permission to use this command.',
            ephemeral: true
        });
    }

    const message = interaction.options.getString('message');

    let config = welcomeConfigs.get(interaction.guild.id) || getDefaultWelcomeConfig();
    config.message = message;

    welcomeConfigs.set(interaction.guild.id, config);

    await interaction.reply({
        content: `✅ Welcome message updated!\n\n**Preview:** ${replacePlaceholders(message, interaction.member)}\n\n**Available placeholders:**\n• \`{user}\` - Mentions the user\n• \`{username}\` - User's username\n• \`{displayname}\` - User's display name\n• \`{server}\` - Server name\n• \`{membercount}\` - Current member count\n• \`{mention}\` - Same as {user}\n• \`{tag}\` - User's tag (username#discriminator)`,
        ephemeral: true
    });
}

async function handleWelcomeEmbed(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({
            content: '❌ You need the "Manage Server" permission to use this command.',
            ephemeral: true
        });
    }

    const useEmbed = interaction.options.getBoolean('enabled');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const color = interaction.options.getString('color');
    const footer = interaction.options.getString('footer');
    const showAvatar = interaction.options.getBoolean('show_avatar');
    const showTimestamp = interaction.options.getBoolean('show_timestamp');

    let config = welcomeConfigs.get(interaction.guild.id) || getDefaultWelcomeConfig();

    if (useEmbed !== null) config.useEmbed = useEmbed;
    if (title) config.embedTitle = title;
    if (description) config.embedDescription = description;
    if (color) {
        // Convert hex color to integer
        const hexColor = color.replace('#', '');
        config.embedColor = parseInt(hexColor, 16);
    }
    if (footer) config.embedFooter = footer;
    if (showAvatar !== null) config.showAvatar = showAvatar;
    if (showTimestamp !== null) config.showTimestamp = showTimestamp;

    welcomeConfigs.set(interaction.guild.id, config);

    await interaction.reply({
        content: `✅ Embed settings updated!\n\n**Embed enabled:** ${config.useEmbed ? 'Yes' : 'No'}\n**Title:** ${config.embedTitle}\n**Description:** ${config.embedDescription}\n**Color:** #${config.embedColor.toString(16).padStart(6, '0')}\n**Footer:** ${config.embedFooter || 'None'}\n**Show avatar:** ${config.showAvatar ? 'Yes' : 'No'}\n**Show timestamp:** ${config.showTimestamp ? 'Yes' : 'No'}`,
        ephemeral: true
    });
}

async function handleWelcomeTest(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({
            content: '❌ You need the "Manage Server" permission to use this command.',
            ephemeral: true
        });
    }

    const config = welcomeConfigs.get(interaction.guild.id);
    if (!config || !config.channelId) {
        return interaction.reply({
            content: '❌ Welcome messages are not set up yet. Use `/welcomesetup` first.',
            ephemeral: true
        });
    }

    const channel = interaction.guild.channels.cache.get(config.channelId);
    if (!channel) {
        return interaction.reply({
            content: '❌ Welcome channel not found. Please run `/welcomesetup` again.',
            ephemeral: true
        });
    }

    try {
        const messageContent = replacePlaceholders(config.message, interaction.member);

        if (config.useEmbed) {
            const embed = new EmbedBuilder()
                .setTitle(replacePlaceholders(config.embedTitle, interaction.member))
                .setDescription(replacePlaceholders(config.embedDescription, interaction.member))
                .setColor(config.embedColor)
                .setThumbnail(config.showAvatar ? interaction.user.displayAvatarURL() : null)
                .setTimestamp(config.showTimestamp ? new Date() : null);

            if (config.embedFooter) {
                embed.setFooter({ text: replacePlaceholders(config.embedFooter, interaction.member) });
            }

            await channel.send({ content: `**[TEST MESSAGE]** ${messageContent || ''}`, embeds: [embed] });
        } else {
            await channel.send(`**[TEST MESSAGE]** ${messageContent}`);
        }

        await interaction.reply({
            content: `✅ Test welcome message sent to ${channel}!`,
            ephemeral: true
        });
    } catch (error) {
        await interaction.reply({
            content: `❌ Failed to send test message: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleWelcomeConfig(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({
            content: '❌ You need the "Manage Server" permission to use this command.',
            ephemeral: true
        });
    }

    const config = welcomeConfigs.get(interaction.guild.id);
    if (!config) {
        return interaction.reply({
            content: '❌ Welcome messages are not configured yet. Use `/welcomesetup` to get started.',
            ephemeral: true
        });
    }

    const channel = interaction.guild.channels.cache.get(config.channelId);
    const channelMention = channel ? `<#${config.channelId}>` : 'Channel not found';

    const embed = new EmbedBuilder()
        .setTitle('Welcome Message Configuration')
        .setColor(0x0099ff)
        .addFields(
            { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Channel', value: channelMention, inline: true },
            { name: 'Use Embed', value: config.useEmbed ? 'Yes' : 'No', inline: true },
            { name: 'Message', value: config.message || 'None', inline: false },
            { name: 'Embed Title', value: config.embedTitle || 'None', inline: true },
            { name: 'Embed Color', value: `#${config.embedColor.toString(16).padStart(6, '0')}`, inline: true },
            { name: 'Show Avatar', value: config.showAvatar ? 'Yes' : 'No', inline: true },
            { name: 'Embed Description', value: config.embedDescription || 'None', inline: false },
            { name: 'Embed Footer', value: config.embedFooter || 'None', inline: false }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleWelcomeDisable(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({
            content: '❌ You need the "Manage Server" permission to use this command.',
            ephemeral: true
        });
    }

    const config = welcomeConfigs.get(interaction.guild.id);
    if (!config || !config.enabled) {
        return interaction.reply({
            content: '❌ Welcome messages are already disabled.',
            ephemeral: true
        });
    }

    config.enabled = false;
    welcomeConfigs.set(interaction.guild.id, config);

    await interaction.reply({
        content: '✅ Welcome messages have been disabled. Use `/welcomesetup` to re-enable them.',
        ephemeral: true
    });
}

// Prefix command handlers (dev/admin commands)
async function handleCommandsPanel(message) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use dev commands.');
    }

    const botColor = getBotColor(message.guild.id);

    // Command categories
    const categories = {
        config: {
            title: '🎨 Bot Configuration',
            description: 'Core bot settings and configuration',
            emoji: '🎨',
            fields: [
                {
                    name: 'Bot Theme',
                    value: '`!setcolor #hexcode` - Set bot color theme',
                    inline: false
                },
                {
                    name: 'Auto Join Role',
                    value: '`!setautorole <role-id>` - Set auto-assign role\n`!removeautorole` - Remove auto join role',
                    inline: false
                },
                {
                    name: 'Member Count',
                    value: '`!setmembercount <channel-id>` - Set member count channel\n`!removemembercount` - Remove member count tracking\n`!setplayercount <channel-id>` - Set player count channel\n`!removeplayercount` - Remove player count tracking',
                    inline: false
                }
            ]
        },
        welcome: {
            title: '📋 Welcome System',
            description: 'Welcome messages and embed settings',
            emoji: '📋',
            fields: [
                {
                    name: 'Setup & Config',
                    value: '`!welcomesetup #channel` - Set welcome channel\n`!welcomeconfig` - View configuration\n`!welcomedisable` - Disable welcome messages',
                    inline: false
                },
                {
                    name: 'Customization',
                    value: '`!welcomemessage <message>` - Set custom message\n`!welcomeembed <options>` - Configure embed style\n`!welcometest` - Test welcome message',
                    inline: false
                }
            ]
        },
        ticket: {
            title: '🎫 Ticket System',
            description: 'Support ticket system configuration',
            emoji: '🎫',
            fields: [
                {
                    name: 'Setup',
                    value: '`!ticketsetup #category` - Set ticket category\n`!ticketrole <role-id>` - Set support role\n`!ticketpanel #channel` - Create ticket panel',
                    inline: false
                },
                {
                    name: 'Management',
                    value: '`!tickettranscript #channel` - Set transcript channel\n`!ticketconfig` - View configuration\n`!ticketdisable` - Disable system',
                    inline: false
                }
            ]
        },
        level: {
            title: '🏅 Leveling & Roles',
            description: 'XP system and level rewards',
            emoji: '🏅',
            fields: [
                {
                    name: 'Level Roles',
                    value: '`!setlevelrole <level> <role>` - Set role for level\n`!removelevelrole <level>` - Remove level role\n`!levelroles` - List all level roles',
                    inline: false
                },
                {
                    name: 'System',
                    value: '`!restart` - Restart the bot (Admin only)',
                    inline: false
                }
            ]
        },
        game: {
            title: '🎮 Roblox Game Stats',
            description: 'Configuration for Roblox game integration',
            emoji: '🎮',
            fields: [
                {
                    name: 'Game Configuration',
                    value: '`!setgameid <place_id>` - Set Roblox Place ID',
                    inline: false
                },
                {
                    name: 'Commands',
                    value: '`/gamestats` - View stats for your Roblox game',
                    inline: false
                }
            ]
        },
        moderation: {
            title: '🛡️ Moderation',
            description: 'Moderation commands and logging',
            emoji: '🛡️',
            fields: [
                {
                    name: 'Actions',
                    value: '`/ban <user> <reason>` - Ban a member\n`/kick <user> <reason>` - Kick a member\n`/warn <user> <reason>` - Warn a member',
                    inline: false
                },
                {
                    name: 'Configuration',
                    value: '`!setlogs #channel` - Set moderation logs channel',
                    inline: false
                }
            ]
        }
    };

    const generateEmbed = (categoryKey) => {
        const category = categories[categoryKey];
        if (!category) {
            // Default "Overview" embed
            return new EmbedBuilder()
                .setTitle('🛠️ Bot Development Commands')
                .setDescription('Select a category from the dropdown menu below to view specific commands.')
                .setColor(botColor)
                .addFields(
                    { name: 'Available Categories', value: '🎨 **Configuration** - Core settings\n📋 **Welcome** - Welcome messages\n🎫 **Tickets** - Support tickets\n🏅 **Leveling** - XP and Roles\n🎮 **Roblox Game** - Game stats & config\n🛡️ **Moderation** - Ban, Kick, Warn & Logs', inline: false }
                )
                .setFooter({ text: 'Use the dropdown menu to navigate categories' })
                .setTimestamp();
        }

        return new EmbedBuilder()
            .setTitle(`🛠️ Commands: ${category.title}`)
            .setDescription(category.description)
            .setColor(botColor)
            .addFields(category.fields)
            .setFooter({ text: 'Use the dropdown menu to switch categories' })
            .setTimestamp();
    };

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('command_category_select')
        .setPlaceholder('Select a command category')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Configuration')
                .setDescription('Core bot settings and configuration')
                .setValue('config')
                .setEmoji('🎨'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Welcome System')
                .setDescription('Welcome messages and embed settings')
                .setValue('welcome')
                .setEmoji('📋'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Ticket System')
                .setDescription('Support ticket system configuration')
                .setValue('ticket')
                .setEmoji('🎫'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Leveling & Roles')
                .setDescription('XP system and level rewards')
                .setValue('level')
                .setEmoji('🏅'),

            new StringSelectMenuOptionBuilder()
                .setLabel('Roblox Game')
                .setDescription('Game integration and stats')
                .setValue('game')
                .setEmoji('🎮'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Moderation')
                .setDescription('Ban, kick, warn and logging')
                .setValue('moderation')
                .setEmoji('🛡️')
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const reply = await message.reply({
        embeds: [generateEmbed(null)],
        components: [row]
    });

    const filter = (interaction) => interaction.customId === 'command_category_select' && interaction.user.id === message.author.id;
    const collector = reply.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async (interaction) => {
        const selectedCategory = interaction.values[0];
        await interaction.update({
            embeds: [generateEmbed(selectedCategory)],
            components: [row]
        });
    });

    collector.on('end', () => {
        row.components[0].setDisabled(true);
        reply.edit({ components: [row] }).catch(() => { });
    });
}

async function handleSetColorPrefix(message, args) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    if (args.length === 0) {
        const currentColor = getBotColor(message.guild.id);
        return message.reply(`❌ Please provide a hex color code. Usage: \`!setcolor #ff0000\`\n\n**Current bot color:** #${currentColor.toString(16).padStart(6, '0')}\n\n**Popular colors:**\n🔴 Red: \`#ff6b6b\`\n🟢 Green: \`#51cf66\`\n🔵 Blue: \`#339af0\`\n🟡 Yellow: \`#ffd43b\`\n🟣 Purple: \`#9775fa\`\n🟠 Orange: \`#ff922b\`\n⚫ Dark: \`#495057\`\n🌸 Pink: \`#f783ac\``);
    }

    const colorInput = args[0];
    let hexColor = colorInput.replace('#', '');

    // Validate hex color
    if (!/^[0-9A-F]{6}$/i.test(hexColor)) {
        return message.reply('❌ Invalid hex color format. Please use format like `#ff0000` or `ff0000`');
    }

    const colorInt = parseInt(hexColor, 16);
    botColors.set(message.guild.id, colorInt);

    const embed = new EmbedBuilder()
        .setTitle('🎨 Bot Color Theme Updated!')
        .setDescription(`The bot's color theme has been changed to **#${hexColor.toUpperCase()}**\n\nThis color will now be used for:\n• Command panels and help embeds\n• Configuration displays\n• System messages\n\n*Note: Welcome message embeds use their own color setting via \`!welcomeembed\`*`)
        .setColor(colorInt)
        .setFooter({ text: 'All future bot embeds will use this color theme' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function handleSetAutoRolePrefix(message, args) {
    if (!message.member.permissions.has('ManageRoles')) {
        return message.reply('❌ You need the "Manage Roles" permission to use this command.');
    }

    if (args.length === 0) {
        const currentRoleId = autoJoinRoles.get(message.guild.id);
        const currentRole = currentRoleId ? message.guild.roles.cache.get(currentRoleId) : null;
        const currentRoleText = currentRole ? `**${currentRole.name}** (\`${currentRole.id}\`)` : 'None';

        return message.reply(`❌ Please provide a role ID. Usage: \`!setautorole <role-id>\`\n\n**Current auto-join role:** ${currentRoleText}\n\n**How to get role ID:**\n1. Enable Developer Mode in Discord settings\n2. Right-click on a role in Server Settings > Roles\n3. Select "Copy Role ID"`);
    }

    const roleId = args[0];
    const role = message.guild.roles.cache.get(roleId);

    if (!role) {
        return message.reply('❌ Role not found. Please provide a valid role ID from this server.\n\n**How to get role ID:**\n1. Enable Developer Mode in Discord settings\n2. Right-click on a role in Server Settings > Roles\n3. Select "Copy Role ID"');
    }

    // Check if bot can assign this role
    const botMember = message.guild.members.cache.get(client.user.id);
    if (role.position >= botMember.roles.highest.position) {
        return message.reply(`❌ I cannot assign the role **${role.name}** because it's higher than or equal to my highest role. Please move my role above **${role.name}** in the server settings.`);
    }

    if (!role.editable) {
        return message.reply(`❌ I don't have permission to assign the role **${role.name}**. Please check my permissions.`);
    }

    autoJoinRoles.set(message.guild.id, role.id);

    const botColor = getBotColor(message.guild.id);
    const embed = new EmbedBuilder()
        .setTitle('👥 Auto Join Role Set!')
        .setDescription(`New members will now automatically receive the **${role.name}** role when they join the server.`)
        .setColor(botColor)
        .addFields(
            { name: 'Role', value: `${role} (\`${role.id}\`)`, inline: true },
            { name: 'Members with this role', value: `${role.members.size}`, inline: true },
            { name: 'Role Position', value: `${role.position}`, inline: true }
        )
        .setFooter({ text: 'New members will receive this role automatically' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function handleRemoveAutoRolePrefix(message) {
    if (!message.member.permissions.has('ManageRoles')) {
        return message.reply('❌ You need the "Manage Roles" permission to use this command.');
    }

    const currentRoleId = autoJoinRoles.get(message.guild.id);
    if (!currentRoleId) {
        return message.reply('❌ No auto-join role is currently set.');
    }

    const role = message.guild.roles.cache.get(currentRoleId);
    const roleName = role ? role.name : 'Unknown Role';

    autoJoinRoles.delete(message.guild.id);

    await message.reply(`✅ Auto-join role removed. New members will no longer automatically receive the **${roleName}** role.`);
}

async function logAction(guild, action, targetUser, moderator, reason, fields = []) {
    const channelId = logChannels.get(guild.id);
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const botColor = getBotColor(guild.id);

    let color = botColor;
    if (action === 'BAN') color = 0xFF0000;      // Red
    else if (action === 'KICK') color = 0xFFA500; // Orange
    else if (action === 'WARN') color = 0xFFFF00; // Yellow

    const embed = new EmbedBuilder()
        .setTitle(`🛡️ Moderation: ${action}`)
        .setColor(color)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
            { name: 'User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
            { name: 'Moderator', value: `${moderator.tag}`, inline: true },
            { name: 'Reason', value: reason || 'No reason provided', inline: false }
        )
        .setTimestamp();

    if (fields.length > 0) {
        embed.addFields(fields);
    }

    try {
        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error(`Failed to send log to ${guild.name}:`, error);
    }
}

async function handleSetLogsPrefix(message, args) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please specify a channel. Usage: `!setlogs #channel`');
    }

    const channelMention = args[0];
    const channelId = channelMention.replace(/[<#>]/g, '');
    const channel = message.guild.channels.cache.get(channelId);

    if (!channel || channel.type !== 0) { // 0 = Text Channel
        return message.reply('❌ Please provide a valid text channel ID or mention. Usage: `!setlogs <channel-id>`');
    }

    logChannels.set(message.guild.id, channel.id);
    await message.reply(`✅ Moderation logs will now be sent to **${channel.name}** (\`${channel.id}\`)!`);
}

async function handleBanSlash(interaction) {
    if (!interaction.member.permissions.has('BanMembers')) {
        return interaction.reply({ content: '❌ You need the "Ban Members" permission.', ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (member) {
        if (!member.bannable) {
            return interaction.reply({ content: '❌ I cannot ban this user. They may have a higher role than me.', ephemeral: true });
        }
    }

    await interaction.deferReply();

    try {
        // Try to DM the user
        try {
            await user.send(`🛑 You have been **BANNED** from **${interaction.guild.name}**.\nReason: ${reason}`);
        } catch (e) { }

        await interaction.guild.members.ban(user, { reason: reason });

        await interaction.editReply(`✅ **${user.tag}** has been banned.`);
        await logAction(interaction.guild, 'BAN', user, interaction.user, reason);

    } catch (error) {
        console.error(error);
        await interaction.editReply('❌ Failed to ban user.');
    }
}

async function handleKickSlash(interaction) {
    if (!interaction.member.permissions.has('KickMembers')) {
        return interaction.reply({ content: '❌ You need the "Kick Members" permission.', ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
        return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.kickable) {
        return interaction.reply({ content: '❌ I cannot kick this user. They may have a higher role than me.', ephemeral: true });
    }

    await interaction.deferReply();

    try {
        // Try to DM
        try {
            await user.send(`⚠️ You have been **KICKED** from **${interaction.guild.name}**.\nReason: ${reason}`);
        } catch (e) { }

        await member.kick(reason);

        await interaction.editReply(`✅ **${user.tag}** has been kicked.`);
        await logAction(interaction.guild, 'KICK', user, interaction.user, reason);

    } catch (error) {
        console.error(error);
        await interaction.editReply('❌ Failed to kick user.');
    }
}

async function handleWarnSlash(interaction) {
    if (!interaction.member.permissions.has('ModerateMembers')) {
        return interaction.reply({ content: '❌ You need the "Moderate Members" permission.', ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    await interaction.deferReply();

    try {
        let dmSent = false;
        try {
            await user.send(`⚠️ **WARNING** from **${interaction.guild.name}**:\n${reason}`);
            dmSent = true;
        } catch (e) {
            dmSent = false;
        }

        await interaction.editReply(`✅ **${user.tag}** has been warned.${!dmSent ? ' (Could not enable DM)' : ''}`);

        // Save warning
        guildWarns.add(interaction.guild.id, user.id, {
            reason: reason,
            moderatorId: interaction.user.id,
            timestamp: Date.now()
        });

        await logAction(interaction.guild, 'WARN', user, interaction.user, reason);

    } catch (error) {
        console.error(error);
        await interaction.editReply('❌ Failed to warn user.');
    }
}

async function handleWarnsPrefix(message, args) {
    const targetUser = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : message.author);

    if (!targetUser) {
        return message.reply('❌ User not found.');
    }

    // Permission check: You can see your own warns, but need permission to see others
    if (targetUser.id !== message.author.id && !message.member.permissions.has('ModerateMembers')) {
        return message.reply('❌ You need the "Moderate Members" permission to view warnings for other users.');
    }

    const warns = guildWarns.get(message.guild.id, targetUser.id);
    const botColor = getBotColor(message.guild.id);

    const embed = new EmbedBuilder()
        .setTitle(`⚠️ Warnings for ${targetUser.username}`)
        .setColor(botColor)
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ text: `Total Warnings: ${warns.length}` })
        .setTimestamp();

    if (warns.length === 0) {
        embed.setDescription('✅ This user has no warnings.');
    } else {
        // Show last 10 warnings to avoid hitting limit
        const recentWarns = warns.slice(-10).reverse();

        // Asynchronously clear promises for moderator fetching
        const fields = await Promise.all(recentWarns.map(async (warn, index) => {
            const moderator = await client.users.fetch(warn.moderatorId).catch(() => ({ tag: 'Unknown Mod' }));
            const date = new Date(warn.timestamp).toLocaleDateString();
            return {
                name: `Warning #${warns.length - index}`,
                value: `**Reason:** ${warn.reason}\n**Mod:** ${moderator.tag} • **Date:** ${date}`,
                inline: false
            };
        }));

        embed.addFields(fields);

        if (warns.length > 10) {
            embed.setDescription(`*Showing last 10 of ${warns.length} warnings*`);
        }
    }

    await message.reply({ embeds: [embed] });
}


async function handleSetMemberCountPrefix(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please specify a voice channel ID. Usage: `!setmembercount <channel-id>`\n\n**How to get channel ID:**\n1. Enable Developer Mode in Discord settings\n2. Right-click on a voice channel\n3. Select "Copy Channel ID"');
    }

    const channelId = args[0];
    const channel = message.guild.channels.cache.get(channelId);

    if (!channel) {
        return message.reply('❌ Channel not found. Please provide a valid channel ID from this server.\n\n**How to get channel ID:**\n1. Enable Developer Mode in Discord settings\n2. Right-click on a voice channel\n3. Select "Copy Channel ID"');
    }

    if (channel.type !== 2) { // 2 = Voice Channel
        return message.reply('❌ Please provide a voice channel ID. The provided ID belongs to a different channel type.');
    }

    memberCountChannels.set(message.guild.id, channel.id);
    await updateMemberCount(message.guild);

    await message.reply(`✅ Member count channel set to **${channel.name}** (\`${channel.id}\`)! The channel name will update automatically.`);
}

async function handleRemoveMemberCountPrefix(message) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    if (!memberCountChannels.has(message.guild.id)) {
        return message.reply('❌ No member count channel is currently set.');
    }

    memberCountChannels.delete(message.guild.id);

    await message.reply('✅ Member count channel removed. The channel name will no longer update automatically.');
}

async function handleWelcomeSetupPrefix(message, args) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please specify a channel. Usage: `!welcomesetup #channel`');
    }

    const channelMention = args[0];
    const channelId = channelMention.replace(/[<#>]/g, '');
    const channel = message.guild.channels.cache.get(channelId);

    if (!channel || channel.type !== 0) {
        return message.reply('❌ Please mention a valid text channel. Usage: `!welcomesetup #channel`');
    }

    let config = welcomeConfigs.get(message.guild.id) || getDefaultWelcomeConfig();
    config.channelId = channel.id;
    config.enabled = true;

    welcomeConfigs.set(message.guild.id, config);

    await message.reply(`✅ Welcome messages will now be sent to ${channel}!\n\nUse other commands to customize:\n• \`!welcomemessage\` - Set custom message\n• \`!welcomeembed\` - Configure embed settings\n• \`!welcometest\` - Test your welcome message`);
}

async function handleWelcomeMessagePrefix(message, args) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please provide a message. Usage: `!welcomemessage Your welcome message here`');
    }

    const welcomeMessage = args.join(' ');

    let config = welcomeConfigs.get(message.guild.id) || getDefaultWelcomeConfig();
    config.message = welcomeMessage;

    welcomeConfigs.set(message.guild.id, config);

    const preview = replacePlaceholders(welcomeMessage, message.member);
    await message.reply(`✅ Welcome message updated!\n\n**Preview:** ${preview}\n\n**Available placeholders:** \`{user}\`, \`{username}\`, \`{displayname}\`, \`{server}\`, \`{membercount}\`, \`{mention}\`, \`{tag}\``);
}

async function handleWelcomeEmbedPrefix(message, args) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please provide embed options. Usage: `!welcomeembed enabled=true title="Welcome!" description="Hello {user}" color=#00ff00`');
    }

    let config = welcomeConfigs.get(message.guild.id) || getDefaultWelcomeConfig();

    const options = args.join(' ');

    // Parse options
    if (options.includes('enabled=true')) config.useEmbed = true;
    if (options.includes('enabled=false')) config.useEmbed = false;

    const titleMatch = options.match(/title="([^"]+)"/);
    if (titleMatch) config.embedTitle = titleMatch[1];

    const descMatch = options.match(/description="([^"]+)"/);
    if (descMatch) config.embedDescription = descMatch[1];

    const colorMatch = options.match(/color=(#?[0-9a-fA-F]{6})/);
    if (colorMatch) {
        const hexColor = colorMatch[1].replace('#', '');
        config.embedColor = parseInt(hexColor, 16);
    }

    const footerMatch = options.match(/footer="([^"]+)"/);
    if (footerMatch) config.embedFooter = footerMatch[1];

    if (options.includes('avatar=true')) config.showAvatar = true;
    if (options.includes('avatar=false')) config.showAvatar = false;

    if (options.includes('timestamp=true')) config.showTimestamp = true;
    if (options.includes('timestamp=false')) config.showTimestamp = false;

    welcomeConfigs.set(message.guild.id, config);

    await message.reply(`✅ Embed settings updated!\n\n**Embed enabled:** ${config.useEmbed ? 'Yes' : 'No'}\n**Title:** ${config.embedTitle}\n**Description:** ${config.embedDescription}\n**Color:** #${config.embedColor.toString(16).padStart(6, '0')}`);
}

async function handleWelcomeTestPrefix(message) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    const config = welcomeConfigs.get(message.guild.id);
    if (!config || !config.channelId) {
        return message.reply('❌ Welcome messages are not set up yet. Use `!welcomesetup #channel` first.');
    }

    const channel = message.guild.channels.cache.get(config.channelId);
    if (!channel) {
        return message.reply('❌ Welcome channel not found. Please run `!welcomesetup` again.');
    }

    try {
        const messageContent = replacePlaceholders(config.message, message.member);

        if (config.useEmbed) {
            const embed = new EmbedBuilder()
                .setTitle(replacePlaceholders(config.embedTitle, message.member))
                .setDescription(replacePlaceholders(config.embedDescription, message.member))
                .setColor(config.embedColor)
                .setThumbnail(config.showAvatar ? message.author.displayAvatarURL() : null)
                .setTimestamp(config.showTimestamp ? new Date() : null);

            if (config.embedFooter) {
                embed.setFooter({ text: replacePlaceholders(config.embedFooter, message.member) });
            }

            await channel.send({ content: `**[TEST MESSAGE]** ${messageContent || ''}`, embeds: [embed] });
        } else {
            await channel.send(`**[TEST MESSAGE]** ${messageContent}`);
        }

        await message.reply(`✅ Test welcome message sent to ${channel}!`);
    } catch (error) {
        await message.reply(`❌ Failed to send test message: ${error.message}`);
    }
}

async function handleWelcomeConfigPrefix(message) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    const config = welcomeConfigs.get(message.guild.id);
    if (!config) {
        return message.reply('❌ Welcome messages are not configured yet. Use `!welcomesetup #channel` to get started.');
    }

    const channel = message.guild.channels.cache.get(config.channelId);
    const channelMention = channel ? `<#${config.channelId}>` : 'Channel not found';
    const botColor = getBotColor(message.guild.id);

    const embed = new EmbedBuilder()
        .setTitle('Welcome Message Configuration')
        .setColor(botColor)
        .addFields(
            { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Channel', value: channelMention, inline: true },
            { name: 'Use Embed', value: config.useEmbed ? 'Yes' : 'No', inline: true },
            { name: 'Message', value: config.message || 'None', inline: false },
            { name: 'Embed Title', value: config.embedTitle || 'None', inline: true },
            { name: 'Embed Color', value: `#${config.embedColor.toString(16).padStart(6, '0')}`, inline: true },
            { name: 'Show Avatar', value: config.showAvatar ? 'Yes' : 'No', inline: true },
            { name: 'Embed Description', value: config.embedDescription || 'None', inline: false },
            { name: 'Embed Footer', value: config.embedFooter || 'None', inline: false }
        )
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function handleWelcomeDisablePrefix(message) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    const config = welcomeConfigs.get(message.guild.id);
    if (!config || !config.enabled) {
        return message.reply('❌ Welcome messages are already disabled.');
    }

    config.enabled = false;
    welcomeConfigs.set(message.guild.id, config);

    await message.reply('✅ Welcome messages have been disabled. Use `!welcomesetup #channel` to re-enable them.');
}

async function handleRestartPrefix(message) {
    if (!message.member.permissions.has('Administrator')) {
        return message.reply('❌ You need the "Administrator" permission to restart the bot.');
    }

    await message.reply('♻️ Restarting bot...');

    console.log(`Bot restart initiated by ${message.author.tag}`);

    // Spawn new process
    const child = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: 'inherit'
    });

    // Unreference the child so the parent can exit without waiting
    child.unref();

    // Kill current process
    process.exit(0);
}

// Ticket system handlers
async function handleTicketSlash(interaction) {
    const config = ticketConfigs.get(interaction.guild.id);
    if (!config || !config.enabled) {
        return interaction.reply({
            content: '❌ The ticket system is not enabled on this server.',
            ephemeral: true
        });
    }

    const reason = interaction.options.getString('reason') || 'No reason provided';
    const result = await createTicket(interaction.guild, interaction.user, reason);

    if (result.error) {
        if (result.channelId) {
            return interaction.reply({
                content: `❌ ${result.error} Your existing ticket: <#${result.channelId}>`,
                ephemeral: true
            });
        }
        return interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true
        });
    }

    if (result.success) {
        return interaction.reply({
            content: `✅ Ticket created successfully! ${result.channel}`,
            ephemeral: true
        });
    }
}

async function handleCloseTicketSlash(interaction) {
    const guildTickets = activeTickets.get(interaction.guild.id);
    if (!guildTickets || !guildTickets.has(interaction.channel.id)) {
        return interaction.reply({
            content: '❌ This is not an active ticket channel.',
            ephemeral: true
        });
    }

    const ticket = guildTickets.get(interaction.channel.id);

    // Only ticket creator or support role can close
    const config = ticketConfigs.get(interaction.guild.id);
    const canClose = ticket.userId === interaction.user.id ||
        (config.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId)) ||
        interaction.member.permissions.has('ManageChannels');

    if (!canClose) {
        return interaction.reply({
            content: '❌ You can only close your own tickets.',
            ephemeral: true
        });
    }

    await closeTicket(interaction.channel, interaction.user, ticket);
    await interaction.reply('🔒 Ticket closed! Use the buttons below to reopen, get transcript, or delete.');
}

async function handleReopenTicketSlash(interaction) {
    const guildClosedTickets = closedTickets.get(interaction.guild.id);
    if (!guildClosedTickets || !guildClosedTickets.has(interaction.channel.id)) {
        return interaction.reply({
            content: '❌ This is not a closed ticket channel.',
            ephemeral: true
        });
    }

    const ticket = guildClosedTickets.get(interaction.channel.id);

    // Only ticket creator or support role can reopen
    const config = ticketConfigs.get(interaction.guild.id);
    const canReopen = ticket.userId === interaction.user.id ||
        (config.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId)) ||
        interaction.member.permissions.has('ManageChannels');

    if (!canReopen) {
        return interaction.reply({
            content: '❌ You can only reopen your own tickets.',
            ephemeral: true
        });
    }

    await reopenTicket(interaction.channel, interaction.user);
    await interaction.reply('🔓 Ticket reopened successfully!');
}

async function handleDeleteTicketSlash(interaction) {
    const guildTickets = activeTickets.get(interaction.guild.id) || new Map();
    const guildClosedTickets = closedTickets.get(interaction.guild.id) || new Map();

    const isTicket = guildTickets.has(interaction.channel.id) || guildClosedTickets.has(interaction.channel.id);

    if (!isTicket) {
        return interaction.reply({
            content: '❌ This is not a ticket channel.',
            ephemeral: true
        });
    }

    const ticket = guildTickets.get(interaction.channel.id) || guildClosedTickets.get(interaction.channel.id);

    // Only ticket creator or support role can delete
    const config = ticketConfigs.get(interaction.guild.id);
    const canDelete = ticket.userId === interaction.user.id ||
        (config.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId)) ||
        interaction.member.permissions.has('ManageChannels');

    if (!canDelete) {
        return interaction.reply({
            content: '❌ You can only delete your own tickets.',
            ephemeral: true
        });
    }

    await deleteTicket(interaction.channel, interaction.user);
    await interaction.reply('🗑️ Deleting ticket in 3 seconds...');
}

async function handleTranscriptSlash(interaction) {
    const guildTickets = activeTickets.get(interaction.guild.id) || new Map();
    const guildClosedTickets = closedTickets.get(interaction.guild.id) || new Map();

    const isTicket = guildTickets.has(interaction.channel.id) || guildClosedTickets.has(interaction.channel.id);

    if (!isTicket) {
        return interaction.reply({
            content: '❌ This is not a ticket channel.',
            ephemeral: true
        });
    }

    await interaction.reply({ content: '📄 Generating transcript...', ephemeral: true });
    await generateTranscript(interaction.channel, interaction.user);
}

async function handleButtonInteraction(interaction) {
    if (interaction.customId === 'create_ticket') {
        const config = ticketConfigs.get(interaction.guild.id);
        if (!config || !config.enabled) {
            return interaction.reply({
                content: '❌ The ticket system is not enabled.',
                ephemeral: true
            });
        }

        const result = await createTicket(interaction.guild, interaction.user);

        if (result.error) {
            if (result.channelId) {
                return interaction.reply({
                    content: `❌ ${result.error} Your existing ticket: <#${result.channelId}>`,
                    ephemeral: true
                });
            }
            return interaction.reply({
                content: `❌ ${result.error}`,
                ephemeral: true
            });
        }

        if (result.success) {
            return interaction.reply({
                content: `✅ Ticket created successfully! ${result.channel}`,
                ephemeral: true
            });
        }
    } else if (interaction.customId === 'close_ticket') {
        const guildTickets = activeTickets.get(interaction.guild.id);
        if (!guildTickets || !guildTickets.has(interaction.channel.id)) {
            return interaction.reply({
                content: '❌ This is not a ticket channel.',
                ephemeral: true
            });
        }

        const ticket = guildTickets.get(interaction.channel.id);

        // Only ticket creator or support role can close
        const config = ticketConfigs.get(interaction.guild.id);
        const canClose = ticket.userId === interaction.user.id ||
            (config.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId)) ||
            interaction.member.permissions.has('ManageChannels');

        if (!canClose) {
            return interaction.reply({
                content: '❌ You can only close your own tickets.',
                ephemeral: true
            });
        }

        await closeTicket(interaction.channel, interaction.user, ticket);
        await interaction.reply('🔒 Closing ticket in 5 seconds...');
    } else if (interaction.customId === 'reopen_ticket') {
        await reopenTicket(interaction.channel, interaction.user);
        await interaction.update({ components: [] });
    } else if (interaction.customId === 'delete_ticket') {
        await deleteTicket(interaction.channel, interaction.user);
        await interaction.reply('🗑️ Deleting ticket in 3 seconds...');
    } else if (interaction.customId === 'transcript_ticket') {
        await generateTranscript(interaction.channel, interaction.user);
        await interaction.reply({ content: '📄 Generating transcript...', ephemeral: true });
    }
}

async function closeTicket(channel, closedBy, ticket) {
    try {
        const botColor = getBotColor(channel.guild.id);
        const closeEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket Closed')
            .setDescription(`This ticket has been closed by ${closedBy}\n\nYou can reopen, delete, or save a transcript using the buttons below.`)
            .setColor(botColor)
            .addFields(
                { name: 'Closed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: 'Ticket Creator', value: `<@${ticket.userId}>`, inline: true }
            )
            .setTimestamp();

        const actionButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('reopen_ticket')
                    .setLabel('Reopen')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🔓'),
                new ButtonBuilder()
                    .setCustomId('transcript_ticket')
                    .setLabel('Transcript')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📄'),
                new ButtonBuilder()
                    .setCustomId('delete_ticket')
                    .setLabel('Delete')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );

        await channel.send({ embeds: [closeEmbed], components: [actionButtons] });

        // Move ticket to closed tickets
        const guildTickets = activeTickets.get(channel.guild.id);
        if (guildTickets) {
            guildTickets.delete(channel.id);
        }

        if (!closedTickets.has(channel.guild.id)) {
            closedTickets.set(channel.guild.id, new Map());
        }

        ticket.closedAt = new Date();
        ticket.closedBy = closedBy.id;
        closedTickets.get(channel.guild.id).set(channel.id, ticket);

        // Update channel permissions - remove send messages for ticket creator
        await channel.permissionOverwrites.edit(ticket.userId, {
            SendMessages: false,
            AddReactions: false
        });

        // Rename channel to indicate it's closed
        const newName = channel.name.replace('ticket-', 'closed-');
        await channel.setName(newName);

    } catch (error) {
        console.error('Failed to close ticket:', error);
    }
}

async function reopenTicket(channel, reopenedBy) {
    try {
        const guildClosedTickets = closedTickets.get(channel.guild.id);
        if (!guildClosedTickets || !guildClosedTickets.has(channel.id)) {
            return;
        }

        const ticket = guildClosedTickets.get(channel.id);

        // Move back to active tickets
        guildClosedTickets.delete(channel.id);

        if (!activeTickets.has(channel.guild.id)) {
            activeTickets.set(channel.guild.id, new Map());
        }
        activeTickets.get(channel.guild.id).set(channel.id, ticket);

        // Restore permissions
        await channel.permissionOverwrites.edit(ticket.userId, {
            SendMessages: true,
            AddReactions: true
        });

        // Rename channel back
        const newName = channel.name.replace('closed-', 'ticket-');
        await channel.setName(newName);

        const botColor = getBotColor(channel.guild.id);
        const reopenEmbed = new EmbedBuilder()
            .setTitle('🔓 Ticket Reopened')
            .setDescription(`This ticket has been reopened by ${reopenedBy}`)
            .setColor(botColor)
            .setTimestamp();

        const closeButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('transcript_ticket')
                    .setLabel('Transcript')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📄')
            );

        await channel.send({ embeds: [reopenEmbed], components: [closeButton] });

    } catch (error) {
        console.error('Failed to reopen ticket:', error);
    }
}

async function deleteTicket(channel, deletedBy) {
    try {
        const botColor = getBotColor(channel.guild.id);
        const deleteEmbed = new EmbedBuilder()
            .setTitle('🗑️ Ticket Deleted')
            .setDescription(`This ticket is being deleted by ${deletedBy}`)
            .setColor(0xff0000)
            .setTimestamp();

        await channel.send({ embeds: [deleteEmbed] });

        // Remove from both active and closed tickets
        const guildTickets = activeTickets.get(channel.guild.id);
        const guildClosedTickets = closedTickets.get(channel.guild.id);

        if (guildTickets) guildTickets.delete(channel.id);
        if (guildClosedTickets) guildClosedTickets.delete(channel.id);

        // Delete channel after 3 seconds
        setTimeout(async () => {
            try {
                await channel.delete();
            } catch (error) {
                console.error('Failed to delete ticket channel:', error);
            }
        }, 3000);

    } catch (error) {
        console.error('Failed to delete ticket:', error);
    }
}

async function generateTranscript(channel, requestedBy) {
    try {
        const config = ticketConfigs.get(channel.guild.id);

        // Fetch all messages in the channel
        const messages = [];
        let lastMessageId;

        while (true) {
            const options = { limit: 100 };
            if (lastMessageId) options.before = lastMessageId;

            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            messages.push(...batch.values());
            lastMessageId = batch.last().id;
        }

        messages.reverse(); // Chronological order

        // Generate HTML transcript
        let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket Transcript - ${channel.name}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #36393f;
            color: #dcddde;
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: #2f3136;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .header {
            border-bottom: 2px solid #4f545c;
            padding-bottom: 20px;
            margin-bottom: 20px;
        }
        .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 2em;
        }
        .header .info {
            color: #b9bbbe;
            margin-top: 10px;
        }
        .message {
            display: flex;
            margin-bottom: 20px;
            padding: 10px;
            border-radius: 5px;
            background-color: #40444b;
        }
        .message:hover {
            background-color: #42464d;
        }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin-right: 15px;
            flex-shrink: 0;
        }
        .message-content {
            flex: 1;
        }
        .message-header {
            display: flex;
            align-items: center;
            margin-bottom: 5px;
        }
        .username {
            font-weight: bold;
            color: #ffffff;
            margin-right: 10px;
        }
        .timestamp {
            color: #72767d;
            font-size: 0.75em;
        }
        .message-text {
            color: #dcddde;
            word-wrap: break-word;
        }
        .attachment {
            background-color: #4f545c;
            border-radius: 3px;
            padding: 8px;
            margin-top: 5px;
            border-left: 4px solid #7289da;
        }
        .embed {
            background-color: #2f3136;
            border-left: 4px solid #7289da;
            padding: 10px;
            margin-top: 5px;
            border-radius: 0 3px 3px 0;
        }
        .bot-tag {
            background-color: #5865f2;
            color: white;
            font-size: 0.65em;
            padding: 2px 4px;
            border-radius: 3px;
            margin-left: 5px;
        }
        .system-message {
            background-color: #5865f2;
            color: white;
            text-align: center;
            padding: 8px;
            border-radius: 5px;
            margin: 10px 0;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎫 Ticket Transcript</h1>
            <div class="info">
                <strong>Server:</strong> ${channel.guild.name}<br>
                <strong>Channel:</strong> #${channel.name}<br>
                <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
                <strong>Requested by:</strong> ${requestedBy.tag}<br>
                <strong>Total Messages:</strong> ${messages.length}
            </div>
        </div>
        <div class="messages">`;

        for (const message of messages) {
            const timestamp = message.createdAt.toLocaleString();
            const author = message.author;
            const content = message.content || '';
            const avatarURL = author.displayAvatarURL({ format: 'png', size: 128 });

            // System messages (like bot joins, etc.)
            if (message.type !== 0) {
                html += `
            <div class="system-message">
                ${message.content || 'System message'}
            </div>`;
                continue;
            }

            html += `
            <div class="message">
                <img src="${avatarURL}" alt="${author.username}" class="avatar">
                <div class="message-content">
                    <div class="message-header">
                        <span class="username">${author.username}</span>
                        ${author.bot ? '<span class="bot-tag">BOT</span>' : ''}
                        <span class="timestamp">${timestamp}</span>
                    </div>
                    <div class="message-text">${content.replace(/\n/g, '<br>')}</div>`;

            // Handle attachments
            if (message.attachments.size > 0) {
                message.attachments.forEach(attachment => {
                    html += `
                    <div class="attachment">
                        📎 <strong>Attachment:</strong> <a href="${attachment.url}" target="_blank">${attachment.name}</a>
                        ${attachment.contentType?.startsWith('image/') ? `<br><img src="${attachment.url}" alt="${attachment.name}" style="max-width: 400px; margin-top: 5px; border-radius: 3px;">` : ''}
                    </div>`;
                });
            }

            // Handle embeds
            if (message.embeds.length > 0) {
                message.embeds.forEach(embed => {
                    html += `
                    <div class="embed">
                        <strong>📋 Embed:</strong> ${embed.title || 'Untitled'}<br>
                        ${embed.description ? `<div style="margin-top: 5px;">${embed.description}</div>` : ''}
                    </div>`;
                });
            }

            html += `
                </div>
            </div>`;
        }

        html += `
        </div>
    </div>
</body>
</html>`;

        // Create transcript file
        const buffer = Buffer.from(html, 'utf8');
        const filename = `transcript-${channel.name}-${Date.now()}.html`;

        // Send transcript to transcript channel if configured, otherwise to current channel
        let targetChannel = channel;
        if (config.transcriptChannelId) {
            const transcriptChannel = channel.guild.channels.cache.get(config.transcriptChannelId);
            if (transcriptChannel) targetChannel = transcriptChannel;
        }

        const botColor = getBotColor(channel.guild.id);
        const transcriptEmbed = new EmbedBuilder()
            .setTitle('📄 Ticket Transcript')
            .setDescription(`HTML transcript generated for ${channel}`)
            .addFields(
                { name: 'Requested by', value: requestedBy.toString(), inline: true },
                { name: 'Messages', value: messages.length.toString(), inline: true },
                { name: 'Generated', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setColor(botColor)
            .setFooter({ text: 'HTML transcript ready for web hosting' })
            .setTimestamp();

        await targetChannel.send({
            embeds: [transcriptEmbed],
            files: [{
                attachment: buffer,
                name: filename
            }]
        });

        // Also send to the ticket channel if transcript was sent elsewhere
        if (targetChannel.id !== channel.id) {
            await channel.send('📄 HTML transcript has been saved and sent to the transcript channel.');
        }

    } catch (error) {
        console.error('Failed to generate transcript:', error);
        await channel.send('❌ Failed to generate transcript. Please try again.');
    }
}

// Ticket prefix command handlers
async function handleTicketSetupPrefix(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please specify a category. Usage: `!ticketsetup #category`');
    }

    const categoryMention = args[0];
    const categoryId = categoryMention.replace(/[<#>]/g, '');
    const category = message.guild.channels.cache.get(categoryId);

    if (!category || category.type !== ChannelType.GuildCategory) {
        return message.reply('❌ Please mention a valid category channel. Usage: `!ticketsetup #category`');
    }

    let config = ticketConfigs.get(message.guild.id) || getDefaultTicketConfig();
    config.categoryId = category.id;
    config.enabled = true;

    ticketConfigs.set(message.guild.id, config);

    await message.reply(`✅ Ticket system enabled! Tickets will be created in the **${category.name}** category.\n\nNext steps:\n• Use \`!ticketrole <role-id>\` to set support role\n• Use \`!ticketpanel #channel\` to create a ticket panel`);
}

async function handleTicketRolePrefix(message, args) {
    if (!message.member.permissions.has('ManageRoles')) {
        return message.reply('❌ You need the "Manage Roles" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please provide a role ID. Usage: `!ticketrole <role-id>`');
    }

    const roleId = args[0];
    const role = message.guild.roles.cache.get(roleId);

    if (!role) {
        return message.reply('❌ Role not found. Please provide a valid role ID from this server.');
    }

    let config = ticketConfigs.get(message.guild.id) || getDefaultTicketConfig();
    config.supportRoleId = role.id;

    ticketConfigs.set(message.guild.id, config);

    await message.reply(`✅ Support role set to **${role.name}**! This role will have access to all tickets and be pinged when new tickets are created.`);
}

async function handleTicketPanelPrefix(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    const config = ticketConfigs.get(message.guild.id);
    if (!config || !config.enabled) {
        return message.reply('❌ Ticket system is not enabled. Use `!ticketsetup` first.');
    }

    let targetChannel = message.channel;

    if (args.length > 0) {
        const channelMention = args[0];
        const channelId = channelMention.replace(/[<#>]/g, '');
        const channel = message.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
            return message.reply('❌ Please mention a valid text channel or use the command in the target channel.');
        }
        targetChannel = channel;
    }

    const botColor = getBotColor(message.guild.id);
    const panelEmbed = new EmbedBuilder()
        .setTitle('🎫 Support Tickets')
        .setDescription('Need help? Create a support ticket and our team will assist you!\n\n**How it works:**\n• Click the button below to create a ticket\n• A private channel will be created for you\n• Our support team will help you there\n• Close the ticket when your issue is resolved')
        .setColor(botColor)
        .setFooter({ text: 'Click the button below to create a ticket' })
        .setTimestamp();

    const ticketButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Create Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫')
        );

    try {
        await targetChannel.send({ embeds: [panelEmbed], components: [ticketButton] });

        config.panelChannelId = targetChannel.id;
        ticketConfigs.set(message.guild.id, config);

        if (targetChannel.id !== message.channel.id) {
            await message.reply(`✅ Ticket panel created in ${targetChannel}!`);
        } else {
            await message.reply('✅ Ticket panel created in this channel!');
        }
    } catch (error) {
        await message.reply('❌ Failed to create ticket panel. Make sure I have permission to send messages in that channel.');
    }
}

async function handleTicketConfigPrefix(message) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    const config = ticketConfigs.get(message.guild.id);
    if (!config) {
        return message.reply('❌ Ticket system is not configured yet. Use `!ticketsetup #category` to get started.');
    }

    const category = config.categoryId ? message.guild.channels.cache.get(config.categoryId) : null;
    const supportRole = config.supportRoleId ? message.guild.roles.cache.get(config.supportRoleId) : null;
    const panelChannel = config.panelChannelId ? message.guild.channels.cache.get(config.panelChannelId) : null;
    const transcriptChannel = config.transcriptChannelId ? message.guild.channels.cache.get(config.transcriptChannelId) : null;

    const guildTickets = activeTickets.get(message.guild.id);
    const guildClosedTickets = closedTickets.get(message.guild.id);
    const activeCount = guildTickets ? guildTickets.size : 0;
    const closedCount = guildClosedTickets ? guildClosedTickets.size : 0;

    const botColor = getBotColor(message.guild.id);
    const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket System Configuration')
        .setColor(botColor)
        .addFields(
            { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Active Tickets', value: activeCount.toString(), inline: true },
            { name: 'Closed Tickets', value: closedCount.toString(), inline: true },
            { name: 'Total Created', value: config.ticketCounter.toString(), inline: true },
            { name: 'Category', value: category ? `${category.name} (\`${category.id}\`)` : 'Not set', inline: false },
            { name: 'Support Role', value: supportRole ? `${supportRole.name} (\`${supportRole.id}\`)` : 'Not set', inline: true },
            { name: 'Panel Channel', value: panelChannel ? `${panelChannel.name} (\`${panelChannel.id}\`)` : 'Not set', inline: true },
            { name: 'Transcript Channel', value: transcriptChannel ? `${transcriptChannel.name} (\`${transcriptChannel.id}\`)` : 'Not set', inline: false }
        )
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function handleTicketDisablePrefix(message) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    const config = ticketConfigs.get(message.guild.id);
    if (!config || !config.enabled) {
        return message.reply('❌ Ticket system is already disabled.');
    }

    config.enabled = false;
    ticketConfigs.set(message.guild.id, config);

    await message.reply('✅ Ticket system has been disabled. Existing tickets will remain open, but no new tickets can be created.');
}

async function handleTicketTranscriptPrefix(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply('❌ You need the "Manage Channels" permission to use this command.');
    }

    if (args.length === 0) {
        return message.reply('❌ Please specify a channel. Usage: `!tickettranscript #channel`');
    }

    const channelMention = args[0];
    const channelId = channelMention.replace(/[<#>]/g, '');
    const channel = message.guild.channels.cache.get(channelId);

    if (!channel || channel.type !== ChannelType.GuildText) {
        return message.reply('❌ Please mention a valid text channel. Usage: `!tickettranscript #channel`');
    }

    let config = ticketConfigs.get(message.guild.id) || getDefaultTicketConfig();
    config.transcriptChannelId = channel.id;

    ticketConfigs.set(message.guild.id, config);

    await message.reply(`✅ Transcript channel set to **${channel.name}**! All ticket transcripts will be saved there.`);
}

// Leveling system slash command handlers
async function handleLevelSlash(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guild.id;
    const userId = targetUser.id;

    await interaction.deferReply();

    if (!userLevels.has(guildId)) {
        userLevels.set(guildId, new Map());
    }

    const guildLevels = userLevels.get(guildId);
    const userData = guildLevels.get(userId) || { xp: 0, level: 0, lastMessage: 0 };

    // Calculate rank
    const sortedUsers = Array.from(guildLevels.entries())
        .sort(([, a], [, b]) => b.xp - a.xp);
    const rank = sortedUsers.findIndex(([id]) => id === userId) + 1;

    try {
        // Create the visual profile card
        const cardBuffer = await createProfileCard(targetUser, userData, rank, interaction.guild);

        const attachment = new AttachmentBuilder(cardBuffer, {
            name: `level-${targetUser.username}.png`
        });

        // Send just the image without embed
        await interaction.editReply({ files: [attachment] });
    } catch (error) {
        console.error('Failed to create level card:', error);

        try {
            // Try simple fallback
            const cardBuffer = await createSimpleProfileCard(targetUser, userData, rank, interaction.guild);

            const attachment = new AttachmentBuilder(cardBuffer, {
                name: `level-simple-${targetUser.username}.png`
            });

            // Send just the simple image
            await interaction.editReply({ files: [attachment] });
        } catch (fallbackError) {
            console.error('Failed to create simple level card:', fallbackError);

            // Fallback to text-based level display
            const currentLevelXP = calculateXPForLevel(userData.level);
            const nextLevelXP = calculateXPForLevel(userData.level + 1);
            const progressXP = userData.xp - currentLevelXP;
            const neededXP = nextLevelXP - currentLevelXP;

            const progressBar = createProgressBar(progressXP, neededXP, 15);
            const botColor = getBotColor(guildId);

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${targetUser.username}'s Level`)
                .setThumbnail(targetUser.displayAvatarURL())
                .setColor(botColor)
                .addFields(
                    { name: 'Level', value: userData.level.toString(), inline: true },
                    { name: 'Total XP', value: userData.xp.toLocaleString(), inline: true },
                    { name: 'Messages', value: Math.floor(userData.xp / 22).toLocaleString(), inline: true },
                    { name: 'Progress to Next Level', value: `${progressBar}\n${progressXP.toLocaleString()}/${neededXP.toLocaleString()} XP`, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    }
}

async function handleLeaderboardSlash(interaction) {
    const guildId = interaction.guild.id;
    const page = Math.max(1, interaction.options.getInteger('page') || 1);

    if (!userLevels.has(guildId)) {
        return interaction.reply({
            content: '❌ No leveling data found for this server yet.',
            ephemeral: true
        });
    }

    const guildLevels = userLevels.get(guildId);
    const sortedUsers = Array.from(guildLevels.entries())
        .sort(([, a], [, b]) => b.xp - a.xp)
        .slice(0, 100); // Top 100 users

    if (sortedUsers.length === 0) {
        return interaction.reply({
            content: '❌ No users found in the leaderboard.',
            ephemeral: true
        });
    }

    const usersPerPage = 10;
    const totalPages = Math.ceil(sortedUsers.length / usersPerPage);
    const currentPage = Math.min(page, totalPages);

    const startIndex = (currentPage - 1) * usersPerPage;
    const endIndex = startIndex + usersPerPage;
    const pageUsers = sortedUsers.slice(startIndex, endIndex);

    try {
        // Create enhanced leaderboard image
        const leaderboardBuffer = await createLeaderboardCard(interaction.guild, pageUsers, currentPage, totalPages);
        const attachment = new AttachmentBuilder(leaderboardBuffer, { name: 'leaderboard.png' });

        // Create pagination buttons
        const buttons = new ActionRowBuilder();

        if (currentPage > 1) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );
        }

        if (currentPage < totalPages) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
            );
        }

        const components = buttons.components.length > 0 ? [buttons] : [];
        await interaction.reply({ files: [attachment], components });

    } catch (error) {
        console.error('Failed to create leaderboard:', error);

        // Fallback to basic leaderboard
        const botColor = getBotColor(guildId);
        const embed = new EmbedBuilder()
            .setTitle('🏆 Server Leaderboard')
            .setColor(botColor)
            .setFooter({ text: `Page ${currentPage}/${totalPages} • ${sortedUsers.length} total users` })
            .setTimestamp();

        let description = '';
        for (let i = 0; i < pageUsers.length; i++) {
            const [userId, userData] = pageUsers[i];
            const rank = startIndex + i + 1;
            const user = await interaction.guild.members.fetch(userId).catch(() => null);
            const username = user ? user.displayName : 'Unknown User';

            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
            description += `${medal} ${username}\n`;
            description += `Level ${userData.level} • ${userData.xp.toLocaleString()} XP\n\n`;
        }

        embed.setDescription(description);

        // Create pagination buttons
        const buttons = new ActionRowBuilder();

        if (currentPage > 1) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );
        }

        if (currentPage < totalPages) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
            );
        }

        const components = buttons.components.length > 0 ? [buttons] : [];
        await interaction.reply({ embeds: [embed], components });
    }
}


async function handleLeaderboardPagination(interaction) {
    const page = parseInt(interaction.customId.split('_')[1]);
    const guildId = interaction.guild.id;

    if (!userLevels.has(guildId)) {
        return interaction.update({
            content: '❌ No leveling data found for this server yet.',
            components: []
        });
    }

    const guildLevels = userLevels.get(guildId);
    const sortedUsers = Array.from(guildLevels.entries())
        .sort(([, a], [, b]) => b.xp - a.xp)
        .slice(0, 100);

    const usersPerPage = 10;
    const totalPages = Math.ceil(sortedUsers.length / usersPerPage);
    const currentPage = Math.min(page, totalPages);

    const startIndex = (currentPage - 1) * usersPerPage;
    const endIndex = startIndex + usersPerPage;
    const pageUsers = sortedUsers.slice(startIndex, endIndex);

    try {
        // Create enhanced leaderboard image
        const leaderboardBuffer = await createLeaderboardCard(interaction.guild, pageUsers, currentPage, totalPages);
        const attachment = new AttachmentBuilder(leaderboardBuffer, { name: 'leaderboard.png' });

        // Create pagination buttons
        const buttons = new ActionRowBuilder();

        if (currentPage > 1) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );
        }

        if (currentPage < totalPages) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
            );
        }

        const components = buttons.components.length > 0 ? [buttons] : [];
        await interaction.update({ files: [attachment], components, embeds: [] });

    } catch (error) {
        console.error('Failed to create leaderboard:', error);

        // Fallback to basic leaderboard
        const botColor = getBotColor(guildId);
        const embed = new EmbedBuilder()
            .setTitle('🏆 Server Leaderboard')
            .setColor(botColor)
            .setFooter({ text: `Page ${currentPage}/${totalPages} • ${sortedUsers.length} total users` })
            .setTimestamp();

        let description = '';
        for (let i = 0; i < pageUsers.length; i++) {
            const [userId, userData] = pageUsers[i];
            const rank = startIndex + i + 1;
            const user = await interaction.guild.members.fetch(userId).catch(() => null);
            const username = user ? user.displayName : 'Unknown User';

            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
            description += `${medal} ${username}\n`;
            description += `Level ${userData.level} • ${userData.xp.toLocaleString()} XP\n\n`;
        }

        embed.setDescription(description);

        // Create pagination buttons
        const buttons = new ActionRowBuilder();

        if (currentPage > 1) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );
        }

        if (currentPage < totalPages) {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_${currentPage + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
            );
        }

        const components = buttons.components.length > 0 ? [buttons] : [];
        await interaction.update({ embeds: [embed], components });
    }
}

// Level Role Handlers
async function handleSetLevelRolePrefix(message, args) {
    if (!message.member.permissions.has('ManageRoles')) {
        return message.reply('❌ You need the "Manage Roles" permission to use this command.');
    }

    if (args.length < 2) {
        return message.reply('❌ Usage: `!setlevelrole <level> <role_id_or_mention>`');
    }

    const level = parseInt(args[0]);
    if (isNaN(level) || level < 1) {
        return message.reply('❌ Please provide a valid level number (1 or higher).');
    }

    const roleString = args.slice(1).join(' ');
    const roleId = roleString.replace(/[<@&>]/g, '');
    const role = message.guild.roles.cache.get(roleId);

    if (!role) {
        return message.reply(`❌ Role not found. Please provide a valid role ID or mention.`);
    }

    if (message.guild.members.me.roles.highest.comparePositionTo(role) <= 0) {
        return message.reply('❌ I cannot assign this role because it is higher than or equal to my highest role.');
    }

    let guildRoles = levelRoles.get(message.guild.id) || [];
    guildRoles = guildRoles.filter(r => r.level !== level);

    guildRoles.push({ level, roleId: role.id });
    guildRoles.sort((a, b) => a.level - b.level);

    levelRoles.set(message.guild.id, guildRoles);

    await message.reply(`✅ Level role set! **Level ${level}** -> **${role.name}**`);
}

async function handleRemoveLevelRolePrefix(message, args) {
    if (!message.member.permissions.has('ManageRoles')) {
        return message.reply('❌ You need the "Manage Roles" permission to use this command.');
    }

    if (args.length < 1) {
        return message.reply('❌ Usage: `!removelevelrole <level>`');
    }

    const level = parseInt(args[0]);
    if (isNaN(level)) {
        return message.reply('❌ Please provide a valid level number.');
    }

    let guildRoles = levelRoles.get(message.guild.id);
    if (!guildRoles) {
        return message.reply('❌ No level roles configured for this server.');
    }

    const initialLength = guildRoles.length;
    guildRoles = guildRoles.filter(r => r.level !== level);

    if (guildRoles.length === initialLength) {
        return message.reply(`❌ No role configured for Level ${level}.`);
    }

    levelRoles.set(message.guild.id, guildRoles);
    await message.reply(`✅ Removed role configuration for **Level ${level}**.`);
}

async function handleListLevelRolesPrefix(message) {
    const guildRoles = levelRoles.get(message.guild.id);
    if (!guildRoles || guildRoles.length === 0) {
        return message.reply('ℹ️ No level roles configured.');
    }

    const botColor = getBotColor(message.guild.id);
    const embed = new EmbedBuilder()
        .setTitle('🏅 Level Roles')
        .setColor(botColor)
        .setTimestamp();

    let description = '';
    for (const config of guildRoles) {
        const role = message.guild.roles.cache.get(config.roleId);
        const roleName = role ? role.toString() : 'Deleted Role';
        description += `**Level ${config.level}:** ${roleName}\n`;
    }

    embed.setDescription(description);
    await message.reply({ embeds: [embed] });
}

// Game Stats Handler
async function handleGameStatsSlash(interaction) {
    const placeId = gameConfigs.get(interaction.guild.id);

    if (!placeId) {
        return interaction.reply({
            content: '❌ No Game ID configured. Use `!setgameid <place_id>` to set up the Roblox game.',
            ephemeral: true
        });
    }

    await interaction.deferReply();

    try {
        // 1. Get Universe ID using the new public endpoint
        // API: https://apis.roblox.com/universes/v1/places/{placeId}/universe
        const universeResponse = await axios.get(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
        const universeId = universeResponse.data?.universeId;

        if (!universeId) {
            return interaction.editReply('❌ Could not find a game with that Place ID.');
        }

        // 2. Get Game Info (Visits, Playing, etc.)
        // API: https://games.roblox.com/v1/games?universeIds={universeId}
        const gameResponse = await axios.get(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
        const gameData = gameResponse.data.data[0];

        if (!gameData) {
            return interaction.editReply('❌ Failed to fetch game statistics.');
        }

        // 3. Get Thumbnail
        // API: https://thumbnails.roblox.com/v1/games/icons?universeIds={universeId}&size=512x512&format=Png&isCircular=false
        const thumbnailResponse = await axios.get(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`);
        const thumbnail = thumbnailResponse.data.data[0]?.imageUrl || null;

        // 4. Get Votes (Likes/Dislikes)
        // API: https://games.roblox.com/v1/games/votes?universeIds={universeId}
        const votesResponse = await axios.get(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`);
        const votesData = votesResponse.data.data[0];

        const likeRatio = votesData ? Math.round((votesData.upVotes / (votesData.upVotes + votesData.downVotes)) * 100) : 0;

        const botColor = getBotColor(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setTitle(gameData.name)
            .setURL(`https://www.roblox.com/games/${placeId}`)
            .setColor(botColor)
            .addFields(
                { name: '👥 Playing', value: gameData.playing.toLocaleString(), inline: true },
                { name: '👣 Visits', value: gameData.visits.toLocaleString(), inline: true },
                { name: '⭐ Favorites', value: gameData.favoritedCount.toLocaleString(), inline: true },
                { name: '👍 Likes', value: `${votesData?.upVotes?.toLocaleString() || '0'} (${likeRatio}%)`, inline: true },
                { name: '👎 Dislikes', value: `${votesData?.downVotes?.toLocaleString() || '0'}`, inline: true },
                { name: '📅 Updated', value: `<t:${Math.floor(new Date(gameData.updated).getTime() / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Roblox Game Stats' })
            .setTimestamp();

        if (thumbnail) {
            embed.setThumbnail(thumbnail);
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Failed to fetch game stats:', error.message);
        if (error.response?.status === 404) {
            await interaction.editReply('❌ Game not found. Please check the Place ID.');
        } else {
            await interaction.editReply('❌ Failed to fetch game stats. Please make sure the Place ID is valid.');
        }
    }
}

async function handleSetGameIdPrefix(message, args) {
    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply('❌ You need the "Manage Server" permission to use this command.');
    }

    if (args.length === 0) {
        const currentId = gameConfigs.get(message.guild.id);
        if (currentId) {
            return message.reply(`ℹ️ Current Game ID: \`${currentId}\`\nTo change it, use \`!setgameid <place_id>\``);
        }
        return message.reply('❌ Please provide a Roblox Place ID. Usage: `!setgameid <place_id>`');
    }

    const placeId = args[0];
    // Simple validation (numeric check)
    if (!/^\d+$/.test(placeId)) {
        return message.reply('❌ Invalid Place ID. It must be a number.');
    }

    gameConfigs.set(message.guild.id, placeId);
    await message.reply(`✅ Game ID set to **${placeId}**! Now you can use \`/gamestats\` without arguments.`);
}

// Whois Command Handler - Roblox Player Lookup
async function handleWhoisSlash(interaction) {
    const username = interaction.options.getString('username');

    await interaction.deferReply();

    try {
        // 1. Get User ID from username
        const userLookupResponse = await axios.post('https://users.roblox.com/v1/usernames/users', {
            usernames: [username],
            excludeBannedUsers: false
        });

        const userData = userLookupResponse.data.data[0];
        if (!userData) {
            return interaction.editReply('❌ User not found. Please check the username.');
        }

        const userId = userData.id;

        // 2. Get detailed user info
        const userInfoResponse = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
        const userInfo = userInfoResponse.data;

        // 3. Get avatar headshot
        const avatarResponse = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
        const avatarUrl = avatarResponse.data.data[0]?.imageUrl || null;

        // 4. Get friends count
        const friendsResponse = await axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
        const friendsCount = friendsResponse.data.count;

        // 5. Get followers count
        const followersResponse = await axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
        const followersCount = followersResponse.data.count;

        // Calculate account age
        const createdDate = new Date(userInfo.created);
        const accountAgeMs = Date.now() - createdDate.getTime();
        const accountAgeDays = Math.floor(accountAgeMs / (1000 * 60 * 60 * 24));
        const accountAgeYears = Math.floor(accountAgeDays / 365);
        const remainingDays = accountAgeDays % 365;
        const accountAgeText = accountAgeYears > 0
            ? `${accountAgeYears} year${accountAgeYears > 1 ? 's' : ''}, ${remainingDays} days`
            : `${accountAgeDays} days`;

        const botColor = getBotColor(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setTitle(`👤 ${userInfo.displayName}`)
            .setURL(`https://www.roblox.com/users/${userId}/profile`)
            .setColor(botColor)
            .addFields(
                { name: '🏷️ Username', value: `@${userInfo.name}`, inline: true },
                { name: '🆔 User ID', value: userId.toString(), inline: true },
                { name: '📅 Account Age', value: accountAgeText, inline: true },
                { name: '👥 Friends', value: friendsCount.toLocaleString(), inline: true },
                { name: '👤 Followers', value: followersCount.toLocaleString(), inline: true },
                { name: '📆 Created', value: `<t:${Math.floor(createdDate.getTime() / 1000)}:D>`, inline: true }
            )
            .setFooter({ text: 'Roblox Profile Lookup' })
            .setTimestamp();

        if (userInfo.description && userInfo.description.trim()) {
            embed.setDescription(`*"${userInfo.description.substring(0, 200)}${userInfo.description.length > 200 ? '...' : ''}"*`);
        }

        if (avatarUrl) {
            embed.setThumbnail(avatarUrl);
        }

        // Add banned badge if applicable
        if (userInfo.isBanned) {
            embed.addFields({ name: '⛔ Status', value: 'Banned', inline: true });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Failed to fetch Roblox user:', error.message);
        if (error.response?.status === 404) {
            await interaction.editReply('❌ User not found.');
        } else {
            await interaction.editReply('❌ Failed to fetch user profile. Please try again.');
        }
    }
}

// Link Command Handler
async function handleLinkSlash(interaction) {
    // Check if user is already linked
    if (linkedAccounts.has(interaction.user.id)) {
        return interaction.reply({
            content: '❌ You are already linked to a Roblox account! Use `/unlink` if you want to switch accounts.',
            ephemeral: true
        });
    }

    const code = interaction.options.getString('code');

    // Check pending codes
    const pending = pendingCodes.get(code);

    if (!pending) {
        return interaction.reply({
            content: '❌ Invalid or expired verification code. Please generate a new one in-game.',
            ephemeral: true
        });
    }

    const robloxId = pending.robloxId;

    // Check if this Roblox ID is already linked to another Discord user
    // (This is a slow scan, but necessary given the simple data structure)
    // In a real DB we would query by robloxId
    const existingDiscordId = Object.keys(config.users).find(key => config.users[key] === robloxId);
    if (existingDiscordId) {
        return interaction.reply({
            content: '❌ This Roblox account is already linked to another Discord user.',
            ephemeral: true
        });
    }

    // Link account
    linkedAccounts.set(interaction.user.id, robloxId);

    // Mark as complete for polling (game will see this)
    completedCodes.set(code, robloxId);
    pendingCodes.delete(code); // Remove from pending

    // Fetch roblox username and update nickname
    try {
        const userResp = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
        const username = userResp.data.name;
        const displayName = userResp.data.displayName; // Also get display name

        // Update Discord Nickname
        if (interaction.guild.members.me.permissions.has('ManageNicknames')) {
            if (interaction.member.id !== interaction.guild.ownerId) { // Cannot change owner's nickname
                try {
                    const newNickname = `${interaction.user.username} (${displayName})`;
                    await interaction.member.setNickname(newNickname.substring(0, 32)); // Max 32 chars
                } catch (nickError) {
                    console.error('Failed to update nickname:', nickError);
                }
            }
        }

        await interaction.reply({
            content: `✅ Successfully linked to Roblox account: **${username}**!`,
            ephemeral: true
        });

    } catch (e) {
        console.error('Failed to finish linking steps:', e);
        await interaction.reply({
            content: `✅ Successfully linked to Roblox ID: **${robloxId}**!`,
            ephemeral: true
        });
    }
}

// Unlink Command Handler
async function handleUnlinkSlash(interaction) {
    if (!linkedAccounts.has(interaction.user.id)) {
        return interaction.reply({
            content: '❌ You are not currently linked to any Roblox account.',
            ephemeral: true
        });
    }

    linkedAccounts.set(interaction.user.id, null);
    delete config.users[interaction.user.id]; // Properly remove key
    saveConfig();

    await interaction.reply({
        content: '✅ Successfully unlinked your Roblox account.',
        ephemeral: true
    });
}

// Help Command Handler
async function handleHelpSlash(interaction) {
    const botColor = getBotColor(interaction.guild.id);

    const embed = new EmbedBuilder()
        .setTitle('📚 Brainrot Runners Bot Commands')
        .setDescription('Here are the available commands you can use:')
        .setColor(botColor)
        .addFields(
            {
                name: '🎮 Roblox Integration',
                value: '`/link <code>` - Link your Roblox account\n`/unlink` - Unlink your current account\n`/whois <username>` - Lookup a Roblox profile\n`/gamestats` - View game statistics',
                inline: false
            },
            {
                name: '🏆 Leveling & Stats',
                value: '`/level [user]` - Check your level and XP\n`/leaderboard` - View the server XP leaderboard',
                inline: false
            },
            {
                name: '🎫 Support',
                value: '`/ticket [reason]` - Open a support ticket\n`/close` - Close a ticket (in ticket channel)\n`/transcript` - Save ticket history',
                inline: false
            }
        )
        .setFooter({ text: 'Brainrot Runners • Use slash commands to interact' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);