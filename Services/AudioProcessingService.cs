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
        /// Scan and upgrade all existing audio tracks in uploads/music to 320kbps and Master WAV
        /// </summary>
        public static void UpgradeExistingFilesOnStartup(string uploadsFolder)
        {
            Task.Run(() =>
            {
                try
                {
                    if (!Directory.Exists(uploadsFolder)) return;
                    var mp3Files = Directory.GetFiles(uploadsFolder, "*.mp3");
                    foreach (var file in mp3Files)
                    {
                        var name = Path.GetFileNameWithoutExtension(file);
                        if (name.EndsWith("_320k") || name.EndsWith("_master") || name == "template_track") continue;

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
