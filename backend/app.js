const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');
const tourRouter = require('./Routes/tourRoutes');
const userRouter = require('./Routes/userRoutes');
const reveiwRouter = require('./Routes/reviewRoutes');
const appError = require('./utils/appError');
const globalErrorHandler = require('./Controller/globalErrorController');
const cookieParser = require('cookie-parser');
const app = express();

//? parsing cookies from incoming requests
app.use(cookieParser());

//? CORS is a mechanism that allows a server to specify who can access its resources.
app.use(
  cors({
    credentials: true,
    origin: `${process.env.FRONTEND_HOST}`,
  })
);


//? Set security Htpps headerss
app.use(helmet());

//? Developement Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

//? Limit request from same IP

const limiter = rateLimit({
  max: 300,
  windowMs: 60 * 60 * 1000,
  message: ' Too many Requests from this IP, please try again in an hour !',
});
app.use('/api', limiter);

//? body-parser , reading data from the body into req.body
app.use(express.json({ limit: '10kb' }));

//? Data sanitization against nosql query injection
app.use(mongoSanitize());

//? Data sanitization against XSS - cross-site scripting

app.use(xss());

//? Prevent parameter pollution

app.use(
  hpp({
    whitelist: [
      'duration',
      'difficulty',
      'ratingAverage',
      'ratingQuantity',
      'price',
      'maxGroupSize',
    ],
  })
);

//? Serving the static file

app.use(express.static(`${__dirname}/public`));

//? routing

app.use('/api/v1/tours', tourRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/reviews', reveiwRouter);

//? unhandled route

app.all('*', (req, res, next) => {
  next(new appError(`can't find ${req.originalUrl} on this server`, 404));
});

//? Globar error

app.use(globalErrorHandler);

module.exports = app;