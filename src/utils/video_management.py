import os
import time
import shutil

import ffmpeg

from utils.logger_manager import logger


class VideoManagement:

    @staticmethod
    def wait_for_file_release(file, timeout=10):
        """
        Wait until the file is released (not locked anymore) or timeout is reached.
        """
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                with open(file, 'ab'):
                    return True
            except PermissionError:
                time.sleep(0.5)
        return False

    @staticmethod
    def convert_flv_to_mp4(file):
        """
        Convert the video from flv format to mp4 format.
        Only converts if the file is actually FLV format.
        """
        # Check if file actually needs conversion
        if not file.endswith('_flv.mp4'):
            logger.info(f"File already in MP4 format, skipping conversion")
            return
            
        logger.info("Converting to MP4 format...")

        if not VideoManagement.wait_for_file_release(file):
            logger.error(f"File is still locked after waiting. Skipping conversion.")
            return

        # Check if output file already exists
        output_file = file.replace('_flv.mp4', '.mp4')
        if os.path.exists(output_file):
            logger.info(f"Output file already exists, skipping conversion")
            os.remove(file)  # Remove the source file
            return

        try:
            # First, try the standard copy method (fastest)
            try:
                ffmpeg.input(file).output(
                    output_file,
                    c='copy',
                    y='-y',
                ).run(quiet=True, overwrite_output=True)
                
            except ffmpeg.Error as e:
                # If copy fails due to codec issues, just rename the file
                # Many "FLV" files from TikTok are actually MP4 containers
                logger.warning("Direct copy failed, trying simple rename...")
                
                try:
                    # Just rename the file - many _flv.mp4 files are actually valid MP4s
                    shutil.move(file, output_file)
                    logger.info("Successfully renamed file (was already MP4 format)")
                    return
                    
                except Exception as rename_error:
                    logger.error(f"Rename failed: {rename_error}")
                    
                    # Last resort: try basic re-encoding
                    logger.warning("Trying basic re-encoding...")
                    try:
                        ffmpeg.input(file).output(
                            output_file,
                            vcodec='libx264',
                            acodec='aac',
                            preset='ultrafast',
                            y='-y',
                        ).run(quiet=True, overwrite_output=True)
                        
                    except ffmpeg.Error as e2:
                        error_msg = e2.stderr.decode() if hasattr(e2, 'stderr') and e2.stderr else str(e2)
                        if "not implemented" in error_msg.lower():
                            # If conversion fails due to codec, just rename and hope for the best
                            logger.warning("FFmpeg codec not supported, keeping original file as MP4...")
                            try:
                                shutil.copy2(file, output_file)
                                os.remove(file)
                                logger.info("Copied original file as MP4 (may need manual conversion)")
                                return
                            except Exception:
                                logger.error("Could not even copy the file")
                                return
                        else:
                            raise e2
            
            # Verify conversion success
            if os.path.exists(output_file):
                output_size = os.path.getsize(output_file)
                if output_size > 0:
                    # Remove source file only if output exists and has content
                    if os.path.exists(file):
                        os.remove(file)
                    logger.info("Finished converting")
                    return
                else:
                    logger.error(f"Conversion failed - output file is empty")
                    if os.path.exists(output_file):
                        os.remove(output_file)
                    return
            else:
                logger.error(f"Conversion failed - output file not created")
                return
                
        except ffmpeg.Error as e:
            error_msg = e.stderr.decode() if hasattr(e, 'stderr') and e.stderr else str(e)
            
            # Don't log the full FFmpeg output - just the essential error
            if "not implemented" in error_msg.lower():
                logger.error("FFmpeg codec not supported - file may need manual conversion")
                # Still try to rename the file so auto-upload can proceed
                try:
                    shutil.copy2(file, output_file)
                    os.remove(file)
                    logger.warning("Saved file as MP4 without conversion (may need manual processing)")
                except Exception:
                    logger.error("Could not save file")
            else:
                logger.error(f"FFmpeg error occurred during conversion")
            
            # Clean up failed output
            if os.path.exists(output_file):
                os.remove(output_file)
                
        except Exception as e:
            logger.error(f"Conversion error: {str(e)}")
            # Clean up failed output
            if os.path.exists(output_file):
                os.remove(output_file)