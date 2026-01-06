# Discord Member Count Bot

A Discord bot that automatically updates a voice channel's name to show the current member count of your server.

## Features

- **Slash Commands**: Modern Discord slash command interface
- **Member Count Channel**: Automatically updates a voice channel name with current member count
- **Real-time Updates**: Updates immediately when members join or leave
- **Permission Checks**: Only users with "Manage Channels" permission can configure the bot

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create a Discord Application**:
   - Go to https://discord.com/developers/applications
   - Create a new application
   - Go to the "Bot" section and create a bot
   - Copy the bot token

3. **Get your Client ID**:
   - In your Discord application, copy the "Application ID" from the General Information tab

4. **Configure environment variables**:
   - Copy `.env.example` to `.env`
   - Fill in your bot token and client ID:
     ```
     DISCORD_TOKEN=your_bot_token_here
     CLIENT_ID=your_client_id_here
     ```

5. **Deploy slash commands**:
   ```bash
   node deploy-commands.js
   ```

6. **Invite the bot to your server**:
   - Go to the OAuth2 > URL Generator in your Discord application
   - Select "bot" and "applications.commands" scopes
   - Select "Manage Channels" permission
   - Use the generated URL to invite your bot

7. **Start the bot**:
   ```bash
   npm start
   ```

## Commands

### Public Slash Commands (for all users)
#### Tickets
- `/ticket [reason]` - Create a support ticket with optional reason
- `/close` - Close the current ticket (only works in ticket channels)
- `/reopen` - Reopen a closed ticket (only works in closed ticket channels)
- `/delete` - Delete the current ticket permanently (only works in ticket channels)
- `/transcript` - Generate an HTML transcript of the current ticket

#### Leveling System
- `/level [user]` - Check your or someone else's level and XP with a visual profile card
- `/leaderboard [page]` - View the server XP leaderboard with visual cards and pagination
- `/profile [user]` - View detailed visual profile card with progress bars, rank, and stats

### Admin/Dev Commands (prefix commands with !)
**Use `!commands` to see the full dev panel**

#### Bot Theme
- `!setcolor #hexcode` - Set the bot's color theme (affects all bot embeds)

#### Auto Join Role
- `!setautorole <role-id>` - Set a role to automatically assign to new members
- `!removeautorole` - Remove the auto join role

#### Member Count
- `!setmembercount <channel-id>` - Set a voice channel to display member count (use channel ID)
- `!removemembercount` - Stop updating the member count channel

#### Ticket System
- `!ticketsetup #category` - Set up ticket system in a category
- `!ticketrole <role-id>` - Set support role for tickets
- `!ticketpanel [#channel]` - Create ticket panel (in current or specified channel)
- `!tickettranscript #channel` - Set channel for saving ticket transcripts
- `!ticketconfig` - View ticket system configuration
- `!ticketdisable` - Disable ticket system

#### Welcome Messages
- `!welcomesetup #channel` - Set up welcome messages in a text channel
- `!welcomemessage <message>` - Set the welcome message text with placeholders
- `!welcomeembed <options>` - Configure embed appearance and settings
- `!welcometest` - Send a test welcome message to see how it looks
- `!welcomeconfig` - View current welcome message configuration
- `!welcomedisable` - Disable welcome messages

#### Help
- `!commands` - Show the development commands panel with examples

### Welcome Message Placeholders
Use these placeholders in your welcome messages:
- `{user}` - Mentions the user (@username)
- `{username}` - User's username
- `{displayname}` - User's display name
- `{server}` - Server name
- `{membercount}` - Current member count
- `{mention}` - Same as {user}
- `{tag}` - User's tag (username#discriminator)

### Welcome Embed Configuration Examples
```
!welcomeembed enabled=true title="Welcome to {server}!" color=#00ff00
!welcomeembed description="Hello {user}, you're member #{membercount}!" avatar=true
!welcomeembed footer="Enjoy your stay!" timestamp=true
```

### Welcome Message Features
- **Simple Text Messages**: Basic welcome messages with placeholder support
- **Rich Embeds**: Beautiful embedded messages with titles, descriptions, colors
- **Avatar Display**: Show the new member's avatar in the welcome message
- **Timestamps**: Add join timestamps to welcome messages
- **Custom Colors**: Set custom embed colors using hex codes
- **Flexible Configuration**: Mix and match text and embed features

## Permissions Required

- **Manage Channels**: To rename voice channels, create/delete ticket channels, and configure ticket system
- **Manage Roles**: To assign auto-join roles to new members and configure ticket permissions
- **Manage Server**: To configure welcome messages (admin commands)
- **Send Messages**: To send welcome messages, ticket notifications, and respond to commands
- **Embed Links**: To send embedded welcome messages and ticket panels
- **Read Message History**: To process prefix commands
- **Use Slash Commands**: For users to create and close tickets

## How it works

### Leveling System
1. **Automatic XP**: Users gain 15-30 XP per message (60-second cooldown to prevent spam)
2. **Level Calculation**: Levels are calculated using the formula: Level = 0.1 × √XP
3. **Level Up Notifications**: Bot automatically announces when users level up
4. **Leaderboard**: View top users with `/leaderboard` (10 users per page)
5. **Profile Cards**: Detailed stats with `/profile` showing rank, progress bars, and estimates
6. **Progress Tracking**: Visual progress bars show XP progress to next level

### Ticket System
1. **Setup**: Use `!ticketsetup #category` to set a category for tickets
2. **Support Role**: Use `!ticketrole <role-id>` to set which role can access all tickets
3. **Transcript Channel**: Use `!tickettranscript #channel` to set where transcripts are saved
4. **Create Panel**: Use `!ticketpanel #channel` to create a ticket creation panel
5. **User Experience**: Users click the button or use `/ticket` to create tickets
6. **Private Channels**: Each ticket gets its own private channel with proper permissions
7. **Advanced Management**: Close with `/close`, reopen with `/reopen`, delete with `/delete`
8. **HTML Transcripts**: Generate professional HTML transcripts with `/transcript` (ready for web hosting)

### Auto Join Role
1. Enable Developer Mode in Discord settings (User Settings > Advanced > Developer Mode)
2. Go to Server Settings > Roles and right-click on the role you want to auto-assign
3. Select "Copy Role ID"
4. Use `!setautorole <role-id>` with the copied ID
5. New members will automatically receive this role when they join
6. Use `!removeautorole` to stop auto-assigning roles

### Member Count
1. Enable Developer Mode in Discord settings (User Settings > Advanced > Developer Mode)
2. Right-click on a voice channel and select "Copy Channel ID"
3. Use `!setmembercount <channel-id>` with the copied ID
4. The bot will rename that channel to show "Members: X" where X is the current member count
5. The channel name updates automatically when members join or leave
6. Use `!removemembercount` to stop the automatic updates

### Welcome Messages
1. Use `!welcomesetup #channel` to choose a text channel for welcome messages
2. Customize your message with `!welcomemessage` using placeholders like `{user}` and `{server}`
3. Optionally configure rich embeds with `!welcomeembed` for colors, titles, and avatars
4. Test your setup with `!welcometest` to see how it looks
5. View your configuration anytime with `!welcomeconfig`
6. Disable with `!welcomedisable` when needed

**Example Complete Setup:**
```
!commands
!setcolor #ff6b6b
!setautorole 987654321098765432
!setmembercount 123456789012345678
!ticketsetup #tickets
!ticketrole 123456789012345678
!tickettranscript #ticket-logs
!ticketpanel #support
!welcomesetup #general
!welcomemessage Welcome to {server}, {user}! 🎉 You're our {membercount}th member!
!welcomeembed enabled=true title="Welcome to {server}!" color=#00ff00 avatar=true
!welcometest
```

### Leveling System Features
- **Automatic XP Gain**: 15-30 XP per message with spam protection
- **Smart Leveling**: Square root-based leveling curve for balanced progression
- **Level Up Announcements**: Automatic congratulations when users level up
- **Visual Profile Cards**: Custom-generated image cards similar to popular bots like MEE6
- **Real Profile Images**: Generated PNG images with user avatars, progress bars, and stats
- **Comprehensive Stats**: Rank, level, total XP, progress bars, and message estimates
- **Interactive Progress Bars**: Visual XP progress bars with gradients and percentages
- **Anti-Spam Protection**: 60-second cooldown between XP gains
- **Persistent Data**: User progress is saved and tracked per server
- **Rank Badges**: Special rank indicators for top users
- **Custom Styling**: Cards use your bot's color theme for consistency
- **Professional Design**: Clean, modern card design with rounded corners and gradients

### Enhanced Transcript System
- **HTML Format**: Professional web-ready HTML transcripts
- **Discord Styling**: Matches Discord's dark theme with proper styling
- **Complete Message History**: All messages, attachments, and embeds included
- **Avatar Integration**: User avatars displayed in transcript
- **Responsive Design**: Mobile-friendly HTML layout
- **Web Hosting Ready**: Upload directly to your domain for permanent storage
- **Rich Formatting**: Proper timestamps, usernames, and message formatting

### Getting IDs
To get role/channel IDs:
1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
2. **For roles**: Go to Server Settings > Roles, right-click a role, select "Copy Role ID"
3. **For channels**: Right-click any channel, select "Copy Channel ID"
4. Use the copied ID in the respective commands

### Color Theme Examples
```
!setcolor #ff6b6b    # Red theme
!setcolor #51cf66    # Green theme  
!setcolor #339af0    # Blue theme
!setcolor #ffd43b    # Yellow theme
!setcolor #9775fa    # Purple theme
!setcolor #ff922b    # Orange theme
```