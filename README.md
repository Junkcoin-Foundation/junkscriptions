<p align="center">
  <img src="https://github.com/Junkcoin-Foundation/junkcoin-docs/blob/main/assets/logos/logo-junkcoin-horizontal-2500px.png" alt="Junkcoin Logo" width="350"/>
</p>

# Junkscriptions ⛵️📜

Protocol for creating inscriptions on the Junkcoin blockchain.

## ✅ Prerequisites 
### Windows Installation Guide
1. **Install Junkcoin Core**
   - Download [Junkcoin Core v3.0.0.0](https://github.com/Junkcoin-Foundation/junkcoin-core/releases/tag/v3.0.0.0)
   - Run the installer and choose default options
   - Start Junkcoin Core and let it sync

2. **Install Node.js**
   - Download [Node.js LTS](https://nodejs.org/) (v18 or higher)
   - Run Node.js installer
   - Check installation in Command Prompt:
     ```
     node --version
     npm --version
     ```

3. **Install JunkieWally Wallet** (Optional)
   - Install from [Chrome Web Store](https://chromewebstore.google.com/detail/junkiewally-junkcoin-wall/mfcbemlgbahilepdpegjfojgkgdpanlc)
   - Follow extension setup instructions

### Other Operating Systems
#### macOS
```bash
# Using Homebrew
brew install node

# Verify installation
node --version
```

#### Linux (Ubuntu/Debian)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

## ⚙️ Installation

```bash
npm install
```

## Configuration

1. Create your `.env`:

```bash
cp .env.example .env
nano .env
```
Example setting running locally with JunkCoin Core

```plaintext
NODE_RPC_URL=http://127.0.0.1:9771
NODE_RPC_USER=junkCoin
NODE_RPC_PASS=JKCjunkinals
TESTNET=false
FEE_PER_KB=500000
```

2. Configure `junkcoin.conf`:
- Windows location: `%APPDATA%\JunkCoin\junkcoin.conf`
```plaintext
rpcuser=junkCoin
rpcpassword=JKCjunkinals
rpcport=9771
rpcallowip=127.0.0.1
server=1
txindex=1
```

## Usage

### List all available Junkscription-cli commands
```bash
node . help
```

### Wallet Management
```bash
# Create new wallet
node . wallet new

# Sync wallet UTXOs
node . wallet sync

# Check balance
node . wallet balance

# Show wallet info
node . wallet show

# Split UTXOs
node . wallet split <number-of-split>

# Consolidate UTXOs
node . wallet consolidate
```

### Inscriptions
```bash
# Inscribe file
node . mint <address> <file-path>

# Mint junkmap
node . mint-junkmap <address> <start> <end>
```

### JUNK-20 Tokens
```bash
# Deploy token
node . junk-20 deploy <address> <tick> <max> <lim>

# Mint tokens
node . junk-20 mint <address> <tick> <amt> [repeat]

# Transfer tokens
node . junk-20 transfer <address> <tick> <amt>
```

## Examples
```bash
# Create wallet
node . wallet new

# Deploy SAIL token
node . junk-20 deploy JKCaddress SAIL 1000000 100

# Mint SAIL tokens 10 times
node . junk-20 mint JKCaddress SAIL 100 10

# Inscribe image
node . mint JKCaddress ./junk.png

# Mint junkmap range
node . mint-junkmap JKCaddress 1 100
```

## Troubleshooting

### Windows Common Issues
1. **Junkcoin Core Won't Start**
   - Check Windows Firewall settings
   - Run as Administrator
   - Verify enough disk space

2. **Node.js Command Not Found**
   - Restart Command Prompt after installation
   - Add Node.js to System PATH
   - Try installing Node.js again

3. **Connection Error (ECONNREFUSED)**
   - Check `%APPDATA%\JunkCoin\junkcoin.conf` settings
   - Verify Junkcoin Core is running
   - Check RPC port matches `.env`

4. **"Insufficient Priority" Error**
   - Increase `FEE_PER_KB` in `.env`
   - Default is 500000, increase during high demand

## Contributors

- [@senasgr-eth](https://github.com/senasgr-eth)
- [@nodecattel](https://github.com/nodecattel)

## License

MIT License
