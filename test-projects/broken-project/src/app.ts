// Missing env var STRIPE_SECRET_KEY in env.example
const apiKey = process.env.STRIPE_SECRET_KEY;
console.log('Port is:', process.env.PORT);
console.log('New secret:', process.env.NEW_SECRET_API_KEY);
