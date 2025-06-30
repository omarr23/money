# Use Node.js official image
FROM node:20-slim

# Set the working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of your project files
COPY . .

# Expose your app's port (change 3000 if your app uses a different one)
EXPOSE 3000

# Start the app
CMD ["node", "app.js"]
