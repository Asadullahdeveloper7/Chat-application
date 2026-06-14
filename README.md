# Advanced Real-Time Chat Application

A complete real-time chat application with admin panel, user authentication, private messaging, and user profiles. Built with Node.js, Express, Socket.io, and vanilla JavaScript.

## 🌟 Features

✅ **User Authentication**
- Secure signup and login with password hashing
- JWT token-based authentication
- Email verification (via admin approval)

✅ **Admin Panel**
- View pending user approvals
- Approve or reject users
- User management dashboard
- Real-time stats

✅ **Private Messaging**
- One-to-one private chats (like WhatsApp)
- Real-time message delivery via Socket.io
- Chat history persistence
- Clear chat feature

✅ **User Profiles**
- Customizable profile with username and bio
- Profile picture upload
- View other users' profiles
- Profile management

✅ **User Features**
- Online user list
- User search and discovery
- Typing indicators (ready to implement)
- Message timestamps
- Responsive design for all devices

✅ **Extra Features**
- Modern gradient UI design
- Bootstrap responsive layout
- Real-time user online status
- Conversation list
- Message notifications

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Real-time**: Socket.io
- **Authentication**: JWT, bcryptjs
- **Frontend**: HTML5, CSS3, JavaScript
- **File Upload**: express-fileupload
- **Styling**: Bootstrap 5, Font Awesome 6

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)
- Modern web browser

## 🚀 Installation

1. **Navigate to project directory**:
   ```bash
   cd "New folder (2)"
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

## 🎯 Running the Application

### Start the server:
```bash
npm start
```

Server will run on `http://localhost:3000`

### For development (with auto-reload):
```bash
npm run dev
```

## 📖 Usage Guide

### 1. **Home Page** (`http://localhost:3000`)
- View app overview
- Access Login, Signup, and Admin Panel

### 2. **User Signup** (`http://localhost:3000/auth/signup`)
- Create new account with username, email, and password
- Wait for admin approval

### 3. **Admin Panel** (`http://localhost:3000/admin`)
- **Admin Password**: `admin123`
- View pending user approvals
- Approve users to let them login
- Reject users if needed

### 4. **User Login** (`http://localhost:3000/auth/login`)
- Login with approved account
- Access chat interface

### 5. **Chat Interface** (`http://localhost:3000/chat`)
- **Chats Tab**: View active conversations
- **Users Tab**: Browse all online users
- **Select User**: Click any user to start private chat
- **Send Messages**: Type and send real-time messages
- **Profile**: Click profile icon to edit your profile
- **Clear Chat**: Clear conversation history

### 6. **User Profile**
- Update username
- Add bio/about
- Upload profile picture
- Save changes

## 🔑 Default Credentials

### Admin Login:
- **Password**: `admin123`

### Test User (create new):
1. Go to signup
2. Fill in details
3. Go to admin panel
4. Approve the user
5. Login with credentials

## 📂 Project Structure

```
advanced-chat-app/
├── server.js                    # Main server file
├── package.json                 # Dependencies
├── public/
│   ├── index.html              # Home page
│   ├── auth-login.html         # Login page
│   ├── auth-signup.html        # Signup page
│   ├── admin-dashboard.html    # Admin panel
│   ├── user-chat.html          # Chat interface
│   └── uploads/                # User profile pictures
└── README.md                    # This file
```

## 🔒 Security Features

- **Password Hashing**: bcryptjs for secure password storage
- **JWT Tokens**: Secure session management
- **Input Validation**: Server-side validation
- **CORS**: Configured for API security

## 🎨 UI/UX Features

- Gradient modern design
- Fully responsive (mobile, tablet, desktop)
- Smooth animations and transitions
- Intuitive user interface
- Real-time updates
- Color-coded UI elements

## 📱 Responsive Breakpoints

- **Desktop**: Full sidebar + chat area
- **Tablet**: Adjusted layout, flexible components
- **Mobile**: Stacked layout, optimized for touch

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/signup` - User registration
- `POST /api/auth/login` - User login
- `POST /api/admin/login` - Admin login

### Admin
- `GET /api/admin/pending-users` - Get pending users
- `POST /api/admin/approve-user/:userId` - Approve user
- `POST /api/admin/reject-user/:userId` - Reject user

### User Profile
- `GET /api/user/profile/:userId` - Get user profile
- `POST /api/user/profile/update` - Update profile
- `GET /api/users` - Get all approved users

### Chat
- `GET /api/conversations/:userId` - Get user's conversations
- `GET /api/chat/:convId` - Get chat history
- `DELETE /api/chat/:convId/clear` - Clear chat

## 🔌 Socket.io Events

### Client to Server
- `join-chat` - Join chat channel
- `user-online` - Notify user is online
- `send-message` - Send message
- `typing` - User is typing
- `stop-typing` - User stopped typing

### Server to Client
- `receive-message` - Message received
- `message-sent` - Message confirmed sent
- `user-typing` - User is typing
- `user-stop-typing` - User stopped typing
- `online-users` - List of online users

## 🚀 Future Enhancements

- Database integration (MongoDB)
- Group chats
- Message search
- Chat reactions/emojis
- Voice/video calling
- File sharing
- Message encryption
- Push notifications
- Dark mode
- Message read receipts

## 🐛 Troubleshooting

### Port already in use
```bash
PORT=3001 npm start
```

### Dependencies not installing
```bash
npm install --legacy-peer-deps
```

### Socket connection issues
- Check firewall settings
- Clear browser cache
- Ensure server is running
- Check browser console for errors

### Profile picture not uploading
- Check file size (max 5MB)
- Ensure file is an image
- Check `/public/uploads/` directory permissions

## 📝 Notes

- This is a demo with in-memory storage
- For production, use MongoDB or PostgreSQL
- Change admin password in production
- Implement email verification
- Add rate limiting
- Use HTTPS in production

## 📄 License

ISC License - Feel free to use and modify

## 🤝 Support

For issues or questions, check:
- Browser console for error messages
- Server logs for backend errors
- Socket.io documentation: https://socket.io/
- Express documentation: https://expressjs.com/

---

**Enjoy real-time chatting! 💬**
