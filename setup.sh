#!/bin/bash
# Claude-to-Speech Setup Script

set -e

echo "================================================"
echo "   Claude-to-Speech Setup"
echo "================================================"
echo ""

# Check if we're in the right directory
if [ ! -f "requirements.txt" ] || [ ! -d "server" ]; then
    echo "❌ Error: Please run this script from the claude-to-speech directory"
    exit 1
fi

# Step 1: Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install -r requirements.txt
echo "✅ Dependencies installed"
echo ""

# Step 2: Setup server config
if [ ! -f "server/config/secret.py" ]; then
    echo "🔑 Setting up API key..."
    cp server/config/secret.example.py server/config/secret.py

    read -p "Enter your ElevenLabs API key: " api_key

    if [ -z "$api_key" ]; then
        echo "❌ No API key provided. Please edit server/config/secret.py manually."
    else
        # Write the API key to secret.py
        echo "ELEVENLABS_API_KEY = \"$api_key\"" > server/config/secret.py
        echo "✅ API key saved to server/config/secret.py"
    fi
else
    echo "✅ API key already configured (server/config/secret.py exists)"
fi
echo ""

# Step 3: Setup plugin config
if [ ! -f "scripts/config.py" ]; then
    echo "🔧 Setting up plugin configuration..."
    if [ -f "scripts/config.example.py" ]; then
        cp scripts/config.example.py scripts/config.py
    fi
    echo "✅ Plugin config created"
else
    echo "✅ Plugin config already exists"
fi
echo ""

# Step 4: Make hooks executable
echo "🔨 Making hooks executable..."
chmod +x hooks/stop.sh
echo "✅ Hooks configured"
echo ""

# Step 5: Test the setup
echo "🧪 Testing server configuration..."
if python3 -c "from server.config.tts_config import ELEVENLABS_API_KEY; print('✅ Config loads successfully')" 2>/dev/null; then
    echo "✅ Configuration validated"
else
    echo "⚠️  Configuration validation failed - check server/config/secret.py"
fi
echo ""

echo "================================================"
echo "   Setup Complete!"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Start the TTS server:"
echo "   python3 server/tts_server.py"
echo ""
echo "2. In Claude Code, run:"
echo "   /speak"
echo ""
echo "For troubleshooting, see INSTALL.md"
