--[[ 
    INSTRUCTIONS:
    1. Create a "TextLabel" in your Gui.
    2. Put this LocalScript INSIDE that TextLabel.
    3. Make sure you have a Button nearby to click!
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
-- Wait for the event we created in the Server Script
local LinkEvent = ReplicatedStorage:WaitForChild("LinkAccountEvent")

local label = script.Parent

-- 1. SETUP THE BUTTON (Optional Auto-find)
-- This tries to find a button next to the label to trigger the code
local parent = label.Parent
local button = parent:FindFirstChild("LinkButton") or parent:FindFirstChildOfClass("TextButton") or parent:FindFirstChildOfClass("ImageButton")

if button then
    print("Link script found button: " .. button.Name)
    button.MouseButton1Click:Connect(function()
        label.Text = "Generating code..."
        -- Request the code from the Server Script
        LinkEvent:FireServer()
    end)
else
    warn("Could not find a Button next to this Label! You need a button to click to generate the code.")
end

-- 2. LISTEN FOR UPDATES
LinkEvent.OnClientEvent:Connect(function(status, data)
    if status == "CodeGenerated" then
        -- Update the label with the code
        label.Text = "Your code is: " .. tostring(data)
        
    elseif status == "LinkedSuccess" then
        label.Text = "✅ Account Successfully Linked!"
        label.TextColor3 = Color3.fromRGB(85, 255, 127) -- Green
        
    elseif status == "Error" then
        label.Text = "Error: " .. tostring(data)
        label.TextColor3 = Color3.fromRGB(255, 85, 85) -- Red
    end
end)
