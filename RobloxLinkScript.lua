--[[
    DISCORD LINKING SYSTEM SCRIPT
    Place this script in ServerScriptService.
    
    CONFIGURATION:
    1. You need your Discord Bot's public URL.
       If running locally, use ngrok to expose port 3000.
       Example: "https://your-bot-url.com"
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- ⚠️ REPLACE THIS WITH YOUR BOT'S PUBLIC URL ⚠️
local API_URL = "https://serveo.net" -- Replaced serveo URL for completeness, user will likely need to update

-- Setup RemoteEvent
local LinkEvent = Instance.new("RemoteEvent")
LinkEvent.Name = "LinkAccountEvent"
LinkEvent.Parent = ReplicatedStorage

-- Function to generate a random 6-digit code
local function generateCode()
    return string.format("%06d", math.random(0, 999999))
end

-- Handle Link Request
LinkEvent.OnServerEvent:Connect(function(player)
    -- Check if player already has Linked attribute (Client side can also check this but verification is server side)
    if player:GetAttribute("IsLinked") then
         LinkEvent:FireClient(player, "Error", "Already Linked")
         return
    end

    local code = generateCode()
    local userId = player.UserId
    
    print("Generating code " .. code .. " for " .. player.Name)
    
    -- 1. Send code to Discord Bot
    local success, response = pcall(function()
        return HttpService:PostAsync(
            API_URL .. "/api/code",
            HttpService:JSONEncode({
                code = code,
                robloxId = userId
            }),
            Enum.HttpContentType.ApplicationJson
        )
    end)
    
    if success then
        -- Send code back to client to display
        LinkEvent:FireClient(player, "CodeGenerated", code)
        
        -- Start polling for verification
        task.spawn(function()
            local attempts = 0
            while attempts < 60 do -- Poll for 5 minutes (every 5s)
                task.wait(5)
                attempts = attempts + 1
                
                local pollSuccess, pollResult = pcall(function()
                    return HttpService:GetAsync(API_URL .. "/api/status/" .. code)
                end)
                
                if pollSuccess then
                    local data = HttpService:JSONDecode(pollResult)
                    if data.verified then
                        -- SUCCESS! Account linked
                        
                        -- Set Attribute
                        player:SetAttribute("IsLinked", true)

                        LinkEvent:FireClient(player, "LinkedSuccess")
                        print(player.Name .. " has successfully linked their account!")
                        
                        -- HERE IS WHERE YOU GIVE REWARDS (One Time)
                        -- Use DataStore to ensure it's truly one-time if they rejoin
                        
                        -- Example: Give money
                        local leaderstats = player:FindFirstChild("leaderstats")
                        if leaderstats then
                             local money = leaderstats:FindFirstChild("Money") or leaderstats:FindFirstChild("Cash")
                             if money then
                                 money.Value = money.Value + 1000
                             end
                        end
                        
                        break -- Stop polling
                    end
                end
            end
        end)
    else
        warn("Failed to contact Discord Bot: " .. tostring(response))
        LinkEvent:FireClient(player, "Error", "Bot unavailable")
    end
end)

-- Optional: Check if already linked on join (requires bot API to check user status, currently bot pushes status to game on link)
-- Since bot->game communication is poll based or link based, checking "is linked" on join would require a Database or an API endpoint on bot to allow "checkStatus" by UserId.
-- For now, attributes persist for session. For cross-session, save to DataStore.

local DataStoreService = game:GetService("DataStoreService")
local LinkDataStore = DataStoreService:GetDataStore("LinkStatus")

Players.PlayerAdded:Connect(function(player)
    local success, isLinked = pcall(function()
        return LinkDataStore:GetAsync(player.UserId)
    end)
    
    if success and isLinked then
        player:SetAttribute("IsLinked", true)
        print(player.Name .. " loaded as Linked")
    end
end)

Players.PlayerRemoving:Connect(function(player)
    if player:GetAttribute("IsLinked") then
        pcall(function()
           LinkDataStore:SetAsync(player.UserId, true)
        end)
    end
end)
