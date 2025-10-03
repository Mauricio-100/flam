#!/usr/bin/env node

import { Command } from 'commander';
import axios from 'axios';
import chalk from 'chalk';
import path from 'path';
import fse from 'fs-extra';
import FormData from 'form-data';
import os from 'os';

const program = new Command();

// --- CONFIGURATION ---
const API_URL = "https://sarver-fullstack-4.onrender.com";
const CONFIG_PATH = path.join(os.homedir(), '.flamconfig.json');

// --- FONCTIONS UTILITAIRES ---

// Sauvegarde la clé API dans un fichier de configuration
async function saveApiKey(key) {
    await fse.writeJson(CONFIG_PATH, { apiKey: key });
}

// Charge la clé API depuis le fichier de configuration
async function loadApiKey() {
    try {
        const config = await fse.readJson(CONFIG_PATH);
        return config.apiKey;
    } catch (error) {
        return null;
    }
}

// --- DÉFINITION DES COMMANDES ---

program
    .name('flam 🐉')
    .description('Le client en ligne de commande pour le Registre Dragon.')
    .version('1.0.0');

program
    .command('login')
    .description('Connectez-vous et sauvegardez votre clé API.')
    .argument('<email>', 'Votre email')
    .argument('<password>', 'Votre mot de passe')
    .action(async (email, password) => {
        console.log(chalk.yellow('Tentative de connexion...'));
        try {
            // 1. Obtenir le token JWT
            const loginRes = await axios.post(`${API_URL}/auth/login`, { email, password });
            const token = loginRes.data.token;

            // 2. Utiliser le JWT pour obtenir la clé API permanente
            const apiTokenRes = await axios.post(`${API_URL}/user/api-token`, {}, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const apiKey = apiTokenRes.data.api_token;

            // 3. Sauvegarder la clé API
            await saveApiKey(apiKey);
            console.log(chalk.green('✅ Connexion réussie ! Votre clé API a été sauvegardée.'));
        } catch (error) {
            console.error(chalk.red(`Erreur de connexion : ${error.response?.data?.error || error.message}`));
        }
    });

program
    .command('publish')
    .description('Publie un nouveau paquet sur le registre.')
    .argument('<file>', 'Chemin vers le fichier .zip de votre paquet')
    .action(async (filePath) => {
        const apiKey = await loadApiKey();
        if (!apiKey) {
            console.error(chalk.red('Vous n\'êtes pas connecté. Veuillez utiliser `flam login <email> <password>`.'));
            return;
        }
        
        // On essaie de lire un package.json local pour les métadonnées
        let packageName, version, description;
        try {
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

            res.data.forEach(pkg => {
                console.log(
                    `${chalk.cyan.bold(pkg.package_name)}@${chalk.yellow(pkg.version)} - ${chalk.white(pkg.description)} (${chalk.gray(pkg.author)})`
                );
            });
        } catch (error) {
            console.error(chalk.red(`Erreur de recherche : ${error.response?.data?.error || error.message}`));
        }
    });

program
    .command('install')
    .description('Installe un paquet depuis le registre.')
    .argument('<packageName>', 'Le nom du paquet à installer')
    .action(async (packageName) => {
        console.log(chalk.yellow(`Recherche de ${chalk.bold(packageName)}...`));
        try {
            // 1. Obtenir les détails pour trouver la dernière version
            const detailsRes = await axios.get(`${API_URL}/packages/details/${packageName}`);
            const { version } = detailsRes.data;

            console.log(chalk.yellow(`Téléchargement de ${chalk.bold(packageName)}@${chalk.bold(version)}...`));

            // 2. Télécharger le fichier
            const downloadUrl = `${API_URL}/packages/download/${packageName}/${version}`;
            const response = await axios.get(downloadUrl, { responseType: 'stream' });

            // 3. Sauvegarder dans un dossier "flam_modules"
            const installDir = path.join(process.cwd(), 'flam_modules');
            await fse.ensureDir(installDir);
            const filePath = path.join(installDir, `${packageName}-${version}.zip`);
            const writer = fse.createWriteStream(filePath);

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            
            console.log(chalk.green(`✅ Paquet ${chalk.bold(packageName)} installé avec succès dans \`flam_modules\` !`));

        } catch (error) {
             console.error(chalk.red(`Erreur d'installation : ${error.response?.data?.error || `Le paquet "${packageName}" n'a pas été trouvé.`}`));
        }
    });

// Exécute le programme
program.parse(process.argv);
