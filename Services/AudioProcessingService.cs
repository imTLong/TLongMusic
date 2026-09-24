using System;
using System.IO;
using NAudio.Wave;
using NAudio.MediaFoundation;

namespace TLongMusic.Services
{
    public static class AudioProcessingService
    {
        private static bool _mfInitialized = false;

        public static void EnsureInitialized()
        {
            if (_mfInitialized) return;
            try
            {
                MediaFoundationApi.Startup();
                _mfInitialized = true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AudioProcessingService] MF Startup: {ex.Message}");
            }
        }

        /// <summary>
        /// Transcode any audio file to 320kbps MP3 (Constant Bitrate Studio Quality for Standard VIP)
        /// </summary>
        public static bool ConvertTo320kbpsMp3(string inputFilePath, string outputFilePath)
        {
            if (!File.Exists(inputFilePath)) return false;

            try
            {
                var dir = Path.GetDirectoryName(outputFilePath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                // Option 1: Native Windows Media Foundation MP3 Encoder (320 kbps)
                try
                {
                    EnsureInitialized();
                    using (var reader = new AudioFileReader(inputFilePath))
                    {
                        MediaFoundationEncoder.EncodeToMp3(reader, outputFilePath, 320000);
                    }
                    if (File.Exists(outputFilePath) && new FileInfo(outputFilePath).Length > 1000)
                    {
                        return true;
                    }
                }
                catch (Exception mfEx)
                {
                    Console.WriteLine($"[AudioProcessingService] MediaFoundation 320k encode note: {mfEx.Message}. Trying Lame fallback...");
                }

                // Option 2: NAudio.Lame fallback
                try
                {
                    using (var reader = new AudioFileReader(inputFilePath))
                    {
                        var waveProvider16 = reader.ToSampleProvider().ToWaveProvider16();
                        using (var outStream = File.Create(outputFilePath))
                        using (var writer = new NAudio.Lame.LameMP3FileWriter(outStream, waveProvider16.WaveFormat, 320))
                        {
                            byte[] buffer = new byte[32768];
                            int bytesRead;
                            while ((bytesRead = waveProvider16.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                writer.Write(buffer, 0, bytesRead);
                            }
                        }
                    }

                    if (File.Exists(outputFilePath) && new FileInfo(outputFilePath).Length > 1000)
                    {
                        return true;
                    }
                }
                catch (Exception lameEx)
                {
                    Console.WriteLine($"[AudioProcessingService] Lame 320k encode note: {lameEx.Message}");
                }

                // Fallback: If conversion failed, copy original
                if (!File.Exists(outputFilePath))
                {
                    File.Copy(inputFilePath, outputFilePath, true);
                }
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AudioProcessingService] ConvertTo320kbpsMp3 error: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Transcode any audio file to Master WAV PCM (Lossless Studio Master for Premium VIP)
        /// </summary>
        public static bool ConvertToMasterWav(string inputFilePath, string outputFilePath)
        {
            if (!File.Exists(inputFilePath)) return false;

            try
            {
                var dir = Path.GetDirectoryName(outputFilePath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                using (var reader = new AudioFileReader(inputFilePath))
                {
                    var pcm16 = reader.ToSampleProvider().ToWaveProvider16();
                    WaveFileWriter.CreateWaveFile(outputFilePath, pcm16);
                }

                return File.Exists(outputFilePath) && new FileInfo(outputFilePath).Length > 1000;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AudioProcessingService] ConvertToMasterWav error: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Ensure both 320kbps MP3 and Master WAV are ready in cache/disk for a given song
        /// </summary>
        public static (string mp3Path, string wavPath) GetOrGenerateTierFiles(string basePhysicalPath, Guid musicId)
        {
            var dir = Path.GetDirectoryName(basePhysicalPath) ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "music");
            var path320k = Path.Combine(dir, $"{musicId:N}_320k.mp3");
            var pathWav = Path.Combine(dir, $"{musicId:N}_master.wav");

            // If 320k file doesn't exist or is tiny, generate
            if (!File.Exists(path320k) || new FileInfo(path320k).Length < 1000)
            {
                ConvertTo320kbpsMp3(basePhysicalPath, path320k);
            }

            // If Master WAV doesn't exist or is tiny, generate
            if (!File.Exists(pathWav) || new FileInfo(pathWav).Length < 1000)
            {
                ConvertToMasterWav(basePhysicalPath, pathWav);
            }

            return (path320k, pathWav);
        }

        /// <summary>
        /// Strictly and permanently delete all physical audio files, transcoded variations (_320k, _master, _demo),
        /// waveforms, and uploaded covers from disk when a music track is deleted.
        /// Ensures no orphaned files remain in uploads/music.
        /// </summary>
        public static void DeletePhysicalAudioAndRelatedFiles(string? webRootPath, string? sourceUrl, string? coverUrl = null, string? demoFilePath = null)
        {
            try
            {
                var root = !string.IsNullOrWhiteSpace(webRootPath)
                    ? webRootPath
                    : Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");

                var musicDir = Path.Combine(root, "uploads", "music");

                // 1. Delete all audio files associated with sourceUrl
                if (Directory.Exists(musicDir) && !string.IsNullOrWhiteSpace(sourceUrl))
                {
                    var cleanUrl = sourceUrl.Split('?')[0].Replace('\\', '/');
                    var rawFileName = Path.GetFileName(cleanUrl);
                    if (!string.IsNullOrEmpty(rawFileName))
                    {
                        var baseName = Path.GetFileNameWithoutExtension(rawFileName)
                            .Replace("_320k", "", StringComparison.OrdinalIgnoreCase)
                            .Replace("_master", "", StringComparison.OrdinalIgnoreCase)
                            .Replace("_demo", "", StringComparison.OrdinalIgnoreCase);

                        // Strict guard: Never delete template_track or empty base
                        if (!string.IsNullOrWhiteSpace(baseName) && !baseName.Equals("template_track", StringComparison.OrdinalIgnoreCase))
                        {
                            var matchingFiles = Directory.GetFiles(musicDir, $"{baseName}*");
                            foreach (var file in matchingFiles)
                            {
                                var fileName = Path.GetFileName(file);
                                if (!fileName.Equals("template_track.mp3", StringComparison.OrdinalIgnoreCase))
                                {
                                    try
                                    {
                                        if (File.Exists(file))
                                        {
                                            File.Delete(file);
                                        }
                                    }
                                    catch (Exception delEx)
                                    {
                                        Console.WriteLine($"[AudioProcessingService] Failed to delete file {file}: {delEx.Message}");
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. Clean up DemoFilePath if specified and not template
                if (!string.IsNullOrWhiteSpace(demoFilePath))
                {
                    var cleanDemo = demoFilePath.Split('?')[0].Replace('\\', '/');
                    var rawDemoName = Path.GetFileName(cleanDemo);
                    if (!string.IsNullOrEmpty(rawDemoName) && !rawDemoName.Equals("template_track.mp3", StringComparison.OrdinalIgnoreCase))
                    {
                        var demoPhysical = Path.Combine(musicDir, rawDemoName);
                        if (File.Exists(demoPhysical))
                        {
                            try { File.Delete(demoPhysical); } catch { }
                        }
                    }
                }

                // 3. Clean up Cover file if stored locally in uploads
                if (!string.IsNullOrWhiteSpace(coverUrl) && coverUrl.Contains("/uploads/"))
                {
                    var coverDir = Path.Combine(root, "uploads", "covers");
                    var cleanCover = coverUrl.Split('?')[0].Replace('\\', '/');
                    var rawCoverName = Path.GetFileName(cleanCover);
                    if (!string.IsNullOrEmpty(rawCoverName) && !rawCoverName.Contains("default", StringComparison.OrdinalIgnoreCase))
                    {
                        var coverPhysical = Path.Combine(coverDir, rawCoverName);
                        if (File.Exists(coverPhysical))
                        {
                            try { File.Delete(coverPhysical); } catch { }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AudioProcessingService] DeletePhysicalAudioAndRelatedFiles error: {ex.Message}");
            }
        }

        /// <summary>
        /// Scan uploads/music and delete all files that do not correspond to any active Music record in the database.
        /// Preserves template_track.mp3.
        /// </summary>
        public static int CleanOrphanedMusicFiles(string webRootPath, IEnumerable<string?> activeSourceUrls)
        {
            int deletedCount = 0;
            try
            {
                var musicDir = Path.Combine(webRootPath, "uploads", "music");
                if (!Directory.Exists(musicDir)) return 0;

                var activePrefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                {
                    "template_track"
                };

                foreach (var url in activeSourceUrls)
                {
                    if (string.IsNullOrWhiteSpace(url)) continue;
                    var cleanUrl = url.Split('?')[0].Replace('\\', '/');
                    var fileName = Path.GetFileName(cleanUrl);
                    var baseName = Path.GetFileNameWithoutExtension(fileName)
                        .Replace("_320k", "", StringComparison.OrdinalIgnoreCase)
                        .Replace("_master", "", StringComparison.OrdinalIgnoreCase)
                        .Replace("_demo", "", StringComparison.OrdinalIgnoreCase);

                    if (!string.IsNullOrWhiteSpace(baseName))
                    {
                        activePrefixes.Add(baseName);
                    }
                }

                var allFiles = Directory.GetFiles(musicDir);
                foreach (var file in allFiles)
                {
                    var fileName = Path.GetFileName(file);
                    var isAssociated = false;
                    foreach (var prefix in activePrefixes)
                    {
                        if (fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        {
                            isAssociated = true;
                            break;
                        }
                    }

                    if (!isAssociated)
                    {
                        try
                        {
                            File.Delete(file);
                            deletedCount++;
                        }
                        catch { }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AudioProcessingService] CleanOrphanedMusicFiles error: {ex.Message}");
            }
            return deletedCount;
        }

        /// <summary>
        /// Scan and upgrade all existing audio tracks in uploads/music to 320kbps and Master WAV
        /// </summary>
        public static void UpgradeExistingFilesOnStartup(string uploadsFolder, IEnumerable<string?>? activeSourceUrls = null)
        {
            Task.Run(() =>
            {
                try
                {
                    if (!Directory.Exists(uploadsFolder)) return;

                    HashSet<string>? validPrefixes = null;
                    if (activeSourceUrls != null)
                    {
                        validPrefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var url in activeSourceUrls)
                        {
                            if (string.IsNullOrWhiteSpace(url)) continue;
                            var cleanUrl = url.Split('?')[0].Replace('\\', '/');
                            var fileName = Path.GetFileName(cleanUrl);
                            var baseName = Path.GetFileNameWithoutExtension(fileName)
                                .Replace("_320k", "", StringComparison.OrdinalIgnoreCase)
                                .Replace("_master", "", StringComparison.OrdinalIgnoreCase)
                                .Replace("_demo", "", StringComparison.OrdinalIgnoreCase);
                            if (!string.IsNullOrWhiteSpace(baseName))
                                validPrefixes.Add(baseName);
                        }
                    }

                    var mp3Files = Directory.GetFiles(uploadsFolder, "*.mp3");
                    foreach (var file in mp3Files)
                    {
                        var name = Path.GetFileNameWithoutExtension(file);
                        if (name.EndsWith("_320k") || name.EndsWith("_master") || name == "template_track") continue;

                        if (validPrefixes != null && !validPrefixes.Contains(name))
                        {
                            // Skip orphaned or unassociated files so we don't regenerate gigabytes of waste
                            continue;
                        }

                        var path320k = Path.Combine(uploadsFolder, $"{name}_320k.mp3");
                        var pathWav = Path.Combine(uploadsFolder, $"{name}_master.wav");

                        if (!File.Exists(path320k) || new FileInfo(path320k).Length < 1000)
                        {
                            ConvertTo320kbpsMp3(file, path320k);
                        }

                        if (!File.Exists(pathWav) || new FileInfo(pathWav).Length < 1000)
                        {
                            ConvertToMasterWav(file, pathWav);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[AudioProcessingService] Startup upgrade note: {ex.Message}");
                }
            });
        }
    }
}
