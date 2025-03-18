import express from 'express';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import axios from 'axios';
import AdmZip from 'adm-zip';
import fs from 'fs/promises'; // Use fs.promises for async file operations
import path from 'path';

const app = express();
const PORT = 3000;

// Middleware to validate movie ID
const validateMovieId = (req, res, next) => {
    const movieId = req.params.id;
    if (!movieId || !/^tt\d+$/.test(movieId)) {
        return res.status(400).json({ error: 'Invalid movie ID. Must be in the format "tt1234567".' });
    }
    next();
};

// Route to display guide or instructions when visiting the root URL
app.get('/', (req, res) => {
    res.send(`
        <h1>Welcome to the Movie Subtitles Service!</h1>
        <p>This API allows you to fetch movie subtitles and extract subtitle zip files.</p>
        <h3>Available Routes:</h3>
        <ul>
            <li><strong>/movie/:id</strong> - Get movie details and subtitles for a given IMDB movie ID (e.g., tt1234567).</li>
            <li><strong>/extract-zip?zipUrl=URL</strong> - Extract subtitle zip file from the provided URL.</li>
        </ul>
        <p>Visit these endpoints to interact with the API.</p>
    `);
});

// Route to fetch movie details and subtitles
app.get('/movie/:id', validateMovieId, async (req, res) => {
    const currentURI = `${req.protocol}://${req.get('host')}`;
    const movieId = req.params.id;
    const url = `https://sudo-proxy.lustycodes.workers.dev/?destination=https://yifysubtitles.ch/movie-imdb/${movieId}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);

        const body = await response.text();
        const $ = cheerio.load(body);

        // Extract movie details
        const title = $('h2.movie-main-title').text().trim();
        const poster = $('.img-responsive').attr('src');
        // const release = $('.moviedata span').first().text().trim();

        // Extract all subtitles
        const subtitles = [];
        $('.table.other-subs tbody tr').each((_, el) => {
            const language = $(el).find('.sub-lang').text().trim();
            const linkElement = $(el).find('td a[href*="/subtitles/"]');
            const link = linkElement.length ? `https://yifysubtitles.ch${linkElement.attr('href')}` : null;
            const subtitleNameRaw = linkElement.length ? linkElement.text().trim() : 'Unknown';

            // Clean up subtitle names by splitting and joining them into a list
            const subtitleNames = subtitleNameRaw.split('\n').map(name => name.trim()).filter(name => name.length > 0);

            // Modify the link to end with `.zip`
            const modifiedLink = link ? link.replace('/subtitles/', '/subtitle/').concat('.zip') : null;

            const extractLink = `${currentURI}/extract-zip?zipUrl=${modifiedLink}`

            if (language) {
                subtitles.push({ names: subtitleNames, language, link: extractLink });
            }
        });

        const movieData = { id: movieId, title, poster, subtitles };
        res.json(movieData);
    } catch (error) {
        console.error('Error fetching movie data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to handle the zip extraction and return subtitle as plain text
app.get('/extract-zip', async (req, res) => {
    const zipUrl = req.query.zipUrl;

    if (!zipUrl) {
        return res.status(400).send('No zip URL provided');
    }

    try {
        // Validate the zip URL
        if (!/^https?:\/\/.*\.zip$/.test(zipUrl)) {
            return res.status(400).send('Invalid zip URL. Must be a valid HTTP/HTTPS URL ending with .zip');
        }

        // Extract the subtitle file name from the URL (after the last slash)
        const zipFileName = zipUrl.split('/').pop(); // Get the filename part

        // Set up the path to extract inside your project folder (e.g., ./subtitles)
        const extractPath = path.join('./');
        // const extractPath = path.join('./subtitles');
        // await fs.mkdir(extractPath, { recursive: true }); // Make sure the 'subtitles' directory exists

        // Download the zip file using axios
        const response = await axios.get(zipUrl, { responseType: 'arraybuffer' });

        // Save the zip file to the project directory
        const zipFilePath = path.join(zipFileName);
        await fs.writeFile(zipFilePath, response.data);

        // Extract the zip file
        const zip = new AdmZip(zipFilePath);
        console.log('Extracting to:', extractPath);

        // Extract all files into the 'subtitles' directory within your project
        zip.extractAllTo(extractPath, true);

        // Delete the downloaded zip file after extraction
        await fs.unlink(zipFilePath);

        // Get the extracted files' names
        const extractedFiles = zip.getEntries().map(entry => entry.entryName);

        // Assuming there is only one file, you can read it
        const srtFilePath = path.join(extractPath, extractedFiles[0]);

        // Read the content of the .srt file
        const srtFileContent = await fs.readFile(srtFilePath, 'utf8');

        // Set the response type to text/plain
        res.set('Content-Type', 'text/plain');
        res.send(srtFileContent); // Send the content directly as plain text
    } catch (error) {
        console.error('Error during zip extraction:', error);
        res.status(500).send('Error during zip extraction: ' + error.message);
    }
});

// Start the server
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
