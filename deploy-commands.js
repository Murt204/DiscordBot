const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
require('dotenv').config();

const commands = [
    {
        name: 'ticket',
        description: 'Create a support ticket',
        options: [
            {
                name: 'reason',
                description: 'Reason for creating the ticket',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
    },
    {
        name: 'close',
        description: 'Close the current ticket (only works in ticket channels)',
    },
    {
        name: 'reopen',
        description: 'Reopen a closed ticket (only works in closed ticket channels)',
    },
    {
        name: 'delete',
        description: 'Delete the current ticket permanently (only works in ticket channels)',
    },
    {
        name: 'transcript',
        description: 'Generate a transcript of the current ticket',
    },
    {
        name: 'gamestats',
        description: 'View stats for Brainrot Runners',
    },
    {
        name: 'whois',
        description: 'Look up a Roblox player profile',
        options: [
            {
                name: 'username',
                description: 'Roblox username to look up',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'link',
        description: 'Link your Discord account to Roblox using a verification code',
        options: [
            {
                name: 'code',
                description: 'The 6-digit code from Brainrot Runners',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'unlink',
        description: 'Unlink your Roblox account from Discord',
    },
    {
        name: 'level',
        description: 'Check your or someone else\'s level and XP',
        options: [
            {
                name: 'user',
                description: 'User to check level for (defaults to yourself)',
                type: ApplicationCommandOptionType.User,
                required: false,
            },
        ],
    },
    {
        name: 'leaderboard',
        description: 'View the server XP leaderboard',
        options: [
            {
                name: 'page',
                description: 'Page number to view (defaults to 1)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1,
            },
        ],
    },
    {
        name: 'help',
        description: 'Show available commands',
    },

];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();