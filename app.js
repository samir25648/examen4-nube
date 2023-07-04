require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const mailgun = require('mailgun-js');
const axios = require('axios');

const connection = mysql.createConnection(process.env.DATABASE_URL);
const siteKey = process.env.RECAPTCHA_SITE_KEY;
const secretKey = process.env.RECAPTCHA_SECRET_KEY;

app.set('views', path.join(__dirname, 'models'));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: false }));

// Configuración de Mailgun
const mailgunConfig = {
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
  from: process.env.MAILGUN_FROM_EMAIL,
};

const mg = mailgun(mailgunConfig);

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/vista', (req, res) => {
  res.render('vista');
});

app.get('/register', (req, res) => {
  res.render('register', { siteKey: process.env.RECAPTCHA_SITE_KEY });
});

app.post('/register', (req, res) => {
  const { nombre, apellido, gmail, password, 'g-recaptcha-response': captchaResponse, siteKey } = req.body;

  // Verificar el reCAPTCHA
  const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaResponse}`;

  axios
    .post(verifyUrl)
    .then(response => {
      const { success } = response.data;

      if (success) {
        const query = 'INSERT INTO loginalanya (nombre, apellido, gmail, password) VALUES (?, ?, ?, ?)';
        connection.query(query, [nombre, apellido, gmail, password], (err, result) => {
          if (err) {
            console.error('Error al registrar usuario:', err);
            res.render('register', { error: 'Error al registrar usuario', siteKey });
          } else {
            console.log('Usuario registrado exitosamente');
            // Envío de correo de confirmación
            const mailOptions = {
              from: mailgunConfig.from,
              to: gmail,
              subject: 'Confirmación de registro',
              text: '¡Gracias por registrarte!',
            };

            mg.messages().send(mailOptions, (error, body) => {
              if (error) {
                console.error('Error al enviar el correo de confirmación:', error);
              } else {
                console.log('Correo de confirmación enviado');
              }
            });

            res.redirect('/login');
          }
        });
      } else {
        // El RE-CAPTCHA es inválido, mostrar un error al usuario
        res.render('register', { error: 'Por favor, completa el reCAPTCHA', siteKey });
      }
    })
    .catch(error => {
      // Error al verificar el RE-CAPTCHA
      console.error('Error al verificar reCAPTCHA:', error);
      res.render('register', { error: 'Error al verificar reCAPTCHA', siteKey });
    });
});

app.get('/login', (req, res) => {
  res.render('login', { error: null, accountBlocked: false, siteKey });
});

app.post('/login', async (req, res) => {
  const { gmail, password, 'g-recaptcha-response': captchaResponse } = req.body;

  // Verificar el reCAPTCHA
  const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaResponse}`;

  axios
    .post(verifyUrl)
    .then(response => {
      const { success } = response.data;

      if (success) {
        const query = 'SELECT * FROM loginalanya WHERE gmail = ?';
        connection.query(query, [gmail], (err, results) => {
          if (err) {
            console.error('Error al autenticar usuario:', err);
            res.render('login', { error: 'Error al autenticar usuario', accountBlocked: false, siteKey });
          } else {
            if (results.length === 0) {
              // Credenciales inválidas
              res.render('login', { error: 'Nombre de usuario y/o contraseña no válidos', accountBlocked: false, siteKey });
            } else {
              const user = results[0];
              if (user.intentos_fallidos >= 3) {
                // Cuenta bloqueada
                res.render('login', { error: 'Cuenta Bloqueada', accountBlocked: true, siteKey });
              } else if (user.password !== password) {
                // Credenciales incorrectas
                const intentosFallidos = user.intentos_fallidos + 1;
                const updateQuery = 'UPDATE loginalanya SET intentos_fallidos = ? WHERE id = ?';
                connection.query(updateQuery, [intentosFallidos, user.id], (updateErr) => {
                  if (updateErr) {
                    console.error('Error al actualizar el número de intentos fallidos:', updateErr);
                  }
                  res.render('login', { error: 'Nombre de usuario y/o contraseña no válidos', accountBlocked: false, siteKey });
                });
              } else {
                console.log('Usuario autenticado exitosamente');
                // Restablecer el número de intentos fallidos a 0
                const resetQuery = 'UPDATE loginalanya SET intentos_fallidos = 0 WHERE id = ?';
                connection.query(resetQuery, [user.id], (resetErr) => {
                  if (resetErr) {
                    console.error('Error al restablecer el número de intentos fallidos:', resetErr);
                  }
                  res.redirect('/vista');
                });
              }
            }
          }
        });
      } else {
        // El reCAPTCHA es inválido, mostrar un error al usuario
        res.render('login', { error: 'Por favor, completa el reCAPTCHA', accountBlocked: false, siteKey });
      }
    })
    .catch(error => {
      // Error al verificar el reCAPTCHA
      console.error('Error al verificar reCAPTCHA:', error);
      res.render('login', { error: 'Error al verificar reCAPTCHA', accountBlocked: false, siteKey });
    });
});

app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { success: null });
});

app.post('/forgot-password', (req, res) => {
  const email = req.body.email;
  console.log(email);

  const mailOptions = {
    from: mailgunConfig.from,
    to: email,
    subject: 'Recuperación de contraseña',
    text: 'Aquí está el enlace para restablecer tu contraseña'
  };

  // Enviar el correo de recuperación de contraseña
  mg.messages().send(mailOptions, (error, body) => {
    if (error) {
      // Ocurrió un error al enviar el correo
      console.error('Error al enviar el correo de recuperación:', error);
      res.render('forgot-password', { error: 'Error al enviar el correo de recuperación' });
    } else {
      // El correo se envió correctamente
      console.log('Correo de recuperación enviado');
      res.render('forgot-password', { success: 'Correo de recuperación enviado correctamente' });
    }
  });
});
 

connection.connect((err) => {
  if (err) {
    console.error('Error al conectar a la base de datos:', err);
  } else {
    console.log('Conexión exitosa a la base de datos');
    app.listen(3000, () => {
      console.log('Server is running on http://localhost:3000');
    });
  }
});
