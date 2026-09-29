namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Pure rules behind the Telegram-style chat features (unit tested in Shizhong.Tests): auto-delete timers,
/// who may delete a message for everyone, the edit window and reaction toggling.
/// </summary>
public static class ChatRules
{
    /// <summary>Money, gifts and system lines never expire or vanish for everyone (the ledger and gift records refer to them).</summary>
    public static readonly string[] Permanent = ["envelope", "transfer", "gift", "system"];

    /// <summary>Longest timer: one year.</summary>
    public const int AutoDeleteMaxSeconds = 366 * 86400;

    /// <summary>
    /// A requested timer in seconds → the stored value: null = off. Values below the configured minimum or above
    /// a year are rejected (null result with ok = false).
    /// </summary>
    public static (bool Ok, int? Seconds) NormalizeTimer(long? requested, int minSeconds)
    {
        if (requested is null or 0) return (true, null);
        if (requested < 0 || requested < Math.Max(1, minSeconds) || requested > AutoDeleteMaxSeconds) return (false, null);
        return (true, (int)requested.Value);
    }

    /// <summary>The time-to-live a new message gets in a chat with this timer (null = keep).</summary>
    public static int? TtlFor(string type, int? chatSeconds, bool enabled) =>
        enabled && chatSeconds is > 0 && !Permanent.Contains(type) ? chatSeconds : null;

    /// <summary>When a message sent at <paramref name="sentAt"/> expires (null = never).</summary>
    public static DateTime? ExpiresAt(DateTime sentAt, string type, int? chatSeconds, bool enabled) =>
        TtlFor(type, chatSeconds, enabled) is { } ttl ? sentAt.AddSeconds(ttl) : null;

    /// <summary>Messages due for deletion at <paramref name="now"/>.</summary>
    public static bool Expired(DateTime? expiresAt, DateTime? deletedAt, DateTime now) => deletedAt is null && expiresAt is { } e && e <= now;

    /// <summary>
    /// Delete for everyone: own messages within the configured window (0 = no limit, like Telegram); in 1:1 chats also the
    /// other person's messages when allowed; in groups admins and the owner may remove anyone's message (moderation).
    /// </summary>
    public static bool CanDeleteForEveryone(string type, bool own, int convKind, int groupRole, DateTime sentAt, DateTime now,
        int limitSeconds, bool peerMessagesAllowed)
    {
        if (Permanent.Contains(type) || type == "recalled") return false;
        if (convKind == ConvKinds.Group && groupRole >= 1) return true;
        if (own) return limitSeconds <= 0 || (now - sentAt).TotalSeconds <= limitSeconds;
        return convKind == ConvKinds.Direct && peerMessagesAllowed;
    }

    /// <summary>Text messages (and media captions) can be edited by their author within the window (hours, 0 = always).</summary>
    public static bool CanEdit(string type, bool own, DateTime sentAt, DateTime now, int windowHours) =>
        own && Editable.Contains(type) && (windowHours <= 0 || (now - sentAt).TotalHours <= windowHours);

    public static readonly string[] Editable = ["text", "emoji", "image", "video", "album", "file"];

    /// <summary>
    /// Toggle one reaction. <paramref name="mine"/> = the user's current reactions on the message, oldest first.
    /// Returns what to add (null = nothing) and what to remove, keeping at most <paramref name="maxPerUser"/>.
    /// </summary>
    public static (string? Add, string[] Remove) ToggleReaction(IReadOnlyList<string> mine, string emoji, int maxPerUser)
    {
        if (mine.Contains(emoji)) return (null, [emoji]);
        var keep = Math.Max(1, maxPerUser) - 1;
        var drop = mine.Count > keep ? mine.Take(mine.Count - keep).ToArray() : [];
        return (emoji, drop);
    }

    /// <summary>Scheduled messages: at least a minute ahead, at most a year.</summary>
    public static bool ValidScheduleTime(DateTime sendAt, DateTime now) => sendAt >= now.AddSeconds(50) && sendAt <= now.AddDays(366);
}
