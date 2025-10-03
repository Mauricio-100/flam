#!/usr/bin/env node

/**
 * flam 🐉 - Le client en ligne de commande pour le Registre Dragon.
 * Ce script gère l'authentification, la publication, la recherche et l'installation de paquets.
 */

// --- IMPORTS DES DÉPENDANCES ---
const { Command } = require('commander');
const axios = require('axios');
const chalk = require('chalk');
const path = require('path');
const fse = require('fs-extra');
const FormData = require('form-data');
const os = require('os');

// --- CONFIGURATION CENTRALE ---
const API_URL = "https://sarver-fullstack-4.onrender.com";
const CONFIG_PATH = path.join(os.homedir(), '.flamconfig.json');

const program = new Command();

// --- FONCTIONS UTILITAIRES ---

/**
 * Sauvegarde la clé API dans un fichier de configuration local.
 * @param {string} key - La clé API à sauvegarder.
 */
async function saveApiKey(key) {
    await fse.writeJson(CONFIG_PATH, { apiKey: key });
}

/**
 * Charge la clé API depuis le fichier de configuration.
 * @returns {Promise<string|null>} La clé API ou null si elle n'est pas trouvée.
 */
async function loadApiKey() {
    try {
        const config = await fse.readJson(CONFIG_PATH);
        return config.apiKey;
    } catch (error) {
        // Si le fichier n'existe pas, on retourne null. C'est un comportement normal.
        return null;
    }
}

// --- DÉFINITION DU PROGRAMME ET DE SES COMMANDES ---

program
    .name('flam 🐉')
    .description('Le client en ligne de commande pour le Registre Dragon.')
    .version('1.0.0');

// --- COMMANDE : login ---
program
    .command('login')
    .description('Connectez-vous et sauvegardez votre clé API.')
    .argument('<email>', 'Votre email')
    .argument('<password>', 'Votre mot de passe')
    .action(async (email, password) => {
        console.log(chalk.yellow('Tentative de connexion...'));
        try {
            // 1. Authentification pour obtenir un token de session
            const loginRes = await axios.post(`${API_URL}/auth/login`, { email, password });
            const token = loginRes.data.token;

            // 2. Utilisation du token pour demander une clé API permanente
            const apiTokenRes = await axios.post(`${API_URL}/user/api-token`, {}, { headers: { 'Authorization': `Bearer ${token}` } });
            const apiKey = apiTokenRes.data.api_token;

            // 3. Sauvegarde de la clé API
            await saveApiKey(apiKey);
            console.log(chalk.green('✅ Connexion réussie ! Votre clé API a été sauvegardée.'));
        } catch (error) {
            console.error(chalk.red(`Erreur de connexion : ${error.response?.data?.error || error.message}`));
        }
    });

// --- COMMANDE : publish ---
program
    .command('publish')
    .description('Publie un nouveau paquet sur le registre.')
    .argument('<file>', 'Chemin vers le fichier .zip de votre paquet')
    .action(async (filePath) => {
        const apiKey = await loadApiKey();
        if (!apiKey) {
            // CORRECTION APPLIQUÉE ICI : Utilisation des backticks `` pour éviter les problèmes d'apostrophe.
            console.error(chalk.red(`Vous n'êtes pas connecté. Veuillez utiliser \`flam login <email> <password>\`.`));
            return;
        }

        let packageName, version, description;
        try {
            // Lecture des métadonnées depuis le package.json local
            const pkgJson = await fse.readJson(path.join(process.cwd(), 'package.json'));
            packageName = pkgJson.name;
            version = pkgJson.version;
            description = pkgJson.description;
        } catch (error) {
            console.error(chalk.red('Erreur : Impossible de trouver ou lire le fichier `package.json` dans le dossier actuel.'));
            return;
        }

        console.log(chalk.yellow(`Publication de ${chalk.bold(packageName)}@${chalk.bold(version)}...`));
        
        try {
            // Préparation des données du formulaire (multipart/form-data) pour l'envoi du fichier
            const form = new FormData();
            form.append('packageName', packageName);
            form.append('version', version);
            form.append('description', description);
            form.append('package', fse.createReadStream(filePath));

            const response = await axios.post(`${API_URL}/packages/publish`, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            console.log(chalk.green(`✅ ${response.data.message}`));
        } catch (error) {
            console.error(chalk.red(`Erreur de publication : ${error.response?.data?.error || error.message}`));
        }
    });

// --- COMMANDE : search ---
program
    .command('search')
    .description('Recherche des paquets sur le registre.')
    .argument('<query>', 'Le terme à rechercher')
    .action(async (query) => {
        console.log(chalk.yellow(`Recherche de paquets pour "${query}"...`));
        try {
            const res = await axios.get(`${API_URL}/packages/search?q=${query}`);
            if (res.data.length === 0) {
                console.log(chalk.white('Aucun paquet trouvé.'));
                return;
            }

            // Affichage des résultats
            res.data.forEach(pkg => {
                console.log(`${chalk.cyan.bold(pkg.package_name)}@${chalk.yellow(pkg.version)} - ${chalk.white(pkg.description)} (${chalk.gray(pkg.author)})`);
            });
        } catch (error) {
            console.error(chalk.red(`Erreur de recherche : ${error.response?.data?.error || error.message}`));
        }
    });

// --- COMMANDE : install ---
program
    .command('install')
    .description('Installe un paquet depuis le registre.')
    .argument('<packageName>', 'Le nom du paquet à installer')
    .action(async (packageName) => {
        console.log(chalk.yellow(`Recherche de ${chalk.bold(packageName)}...`));
        try {
            // 1. Obtenir les détails du paquet pour la dernière version
            const detailsRes = await axios.get(`${API_URL}/packages/details/${packageName}`);
            const { version } = detailsRes.data;

            console.log(chalk.yellow(`Téléchargement de ${chalk.bold(packageName)}@${chalk.bold(version)}...`));

            // 2. Télécharger le fichier .zip
            const downloadUrl = `${API_URL}/packages/download/${packageName}/${version}`;
            const response = await axios.get(downloadUrl, { responseType: 'stream' });

            // 3. Créer le dossier de destination et sauvegarder le fichier
            const installDir = path.join(process.cwd(), 'flam_modules');
            await fse.ensureDir(installDir);
            const filePath = path.join(installDir, `${packageName}-${version}.zip`);
            const writer = fse.createWriteStream(filePath);

            response.data.pipe(writer);

            // 4. Attendre la fin de l'écriture du fichier
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            console.log(chalk.green(`✅ Paquet ${chalk.bold(packageName)} installé avec succès dans \`flam_modules\` !`));
        } catch (error) {
             console.error(chalk.red(`Erreur d'installation : ${error.response?.data?.error || `Le paquet "${packageName}" n'a pas été trouvé.`}`));
        }
    });

// --- DÉMARRAGE DE L'APPLICATION ---
// Analyse les arguments de la ligne de commande et exécute la commande correspondante.
program.parse(process.argv);
