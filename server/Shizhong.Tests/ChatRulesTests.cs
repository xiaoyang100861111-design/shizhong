using Shizhong.Api.Modules.Messaging;
using Shizhong.Api.Modules.Platform;
using Xunit;

public class ChatRulesTests
{
    static readonly DateTime T0 = new(2026, 9, 29, 12, 0, 0, DateTimeKind.Utc);

    // ------------------------------------------------------------ auto-delete timers
    [Fact] public void TimerOffIsNull() => Assert.Equal((true, (int?)null), ChatRules.NormalizeTimer(0, 3600));
    [Fact] public void TimerNullIsOff() => Assert.Equal((true, (int?)null), ChatRules.NormalizeTimer(null, 3600));
    [Fact] public void TimerWeekAccepted() => Assert.Equal((true, (int?)604800), ChatRules.NormalizeTimer(604800, 3600));
    [Fact] public void TimerBelowMinimumRejected() => Assert.False(ChatRules.NormalizeTimer(60, 3600).Ok);
    [Fact] public void TimerAtMinimumAccepted() => Assert.True(ChatRules.NormalizeTimer(60, 60).Ok);
    [Fact] public void TimerAboveYearRejected() => Assert.False(ChatRules.NormalizeTimer(ChatRules.AutoDeleteMaxSeconds + 1, 60).Ok);
    [Fact] public void NegativeTimerRejected() => Assert.False(ChatRules.NormalizeTimer(-5, 60).Ok);

    [Fact] public void TextExpiresAfterTimer() => Assert.Equal(T0.AddDays(7), ChatRules.ExpiresAt(T0, "text", 604800, true));
    [Fact] public void MinuteTimer() => Assert.Equal(T0.AddMinutes(1), ChatRules.ExpiresAt(T0, "album", 60, true));
    [Fact] public void NoTimerNoExpiry() => Assert.Null(ChatRules.ExpiresAt(T0, "text", null, true));
    [Fact] public void DisabledByConsoleNoExpiry() => Assert.Null(ChatRules.ExpiresAt(T0, "text", 86400, false));

    [Theory]
    [InlineData("envelope")]
    [InlineData("transfer")]
    [InlineData("gift")]
    [InlineData("system")]
    public void MoneyGiftsAndSystemLinesNeverExpire(string type) => Assert.Null(ChatRules.ExpiresAt(T0, type, 86400, true));

    [Fact] public void ExpiredWhenDue() => Assert.True(ChatRules.Expired(T0, null, T0));
    [Fact] public void NotExpiredBeforeDue() => Assert.False(ChatRules.Expired(T0.AddSeconds(1), null, T0));
    [Fact] public void AlreadyDeletedIsNotExpiredAgain() => Assert.False(ChatRules.Expired(T0.AddDays(-1), T0.AddHours(-1), T0));
    [Fact] public void NoExpiryNeverExpires() => Assert.False(ChatRules.Expired(null, null, T0.AddYears(5)));

    // ------------------------------------------------------------ delete for everyone
    [Fact] public void OwnMessageNoLimit() =>
        Assert.True(ChatRules.CanDeleteForEveryone("text", true, ConvKinds.Direct, -1, T0.AddYears(-1), T0, 0, false));

    [Fact] public void OwnMessageWithinLimit() =>
        Assert.True(ChatRules.CanDeleteForEveryone("image", true, ConvKinds.Direct, -1, T0.AddSeconds(-50), T0, 60, false));

    [Fact] public void OwnMessagePastLimit() =>
        Assert.False(ChatRules.CanDeleteForEveryone("image", true, ConvKinds.Direct, -1, T0.AddSeconds(-61), T0, 60, false));

    [Fact] public void PeerMessageInDirectChatWhenAllowed() =>
        Assert.True(ChatRules.CanDeleteForEveryone("text", false, ConvKinds.Direct, -1, T0, T0, 0, true));

    [Fact] public void PeerMessageInDirectChatWhenNotAllowed() =>
        Assert.False(ChatRules.CanDeleteForEveryone("text", false, ConvKinds.Direct, -1, T0, T0, 0, false));

    [Fact] public void GroupMemberCannotDeleteOthers() =>
        Assert.False(ChatRules.CanDeleteForEveryone("text", false, ConvKinds.Group, 0, T0, T0, 0, true));

    [Fact] public void GroupAdminModerates() =>
        Assert.True(ChatRules.CanDeleteForEveryone("text", false, ConvKinds.Group, 1, T0.AddYears(-2), T0, 60, false));

    [Fact] public void SupportDeskMessagesStay() =>
        Assert.False(ChatRules.CanDeleteForEveryone("text", false, ConvKinds.Support, -1, T0, T0, 0, true));

    [Theory]
    [InlineData("envelope")]
    [InlineData("transfer")]
    [InlineData("gift")]
    [InlineData("system")]
    public void MoneyIsNeverDeletedForEveryone(string type) =>
        Assert.False(ChatRules.CanDeleteForEveryone(type, true, ConvKinds.Group, 2, T0, T0, 0, true));

    // ------------------------------------------------------------ edit window
    [Fact] public void EditWithin48h() => Assert.True(ChatRules.CanEdit("text", true, T0.AddHours(-47), T0, 48));
    [Fact] public void EditAfter48h() => Assert.False(ChatRules.CanEdit("text", true, T0.AddHours(-49), T0, 48));
    [Fact] public void EditUnlimited() => Assert.True(ChatRules.CanEdit("album", true, T0.AddYears(-3), T0, 0));
    [Fact] public void CannotEditOthers() => Assert.False(ChatRules.CanEdit("text", false, T0, T0, 48));
    [Fact] public void CannotEditVoice() => Assert.False(ChatRules.CanEdit("voice", true, T0, T0, 48));

    // ------------------------------------------------------------ reactions
    [Fact] public void FirstReactionAdds() => Assert.Equal(("❤️", ""), Norm(ChatRules.ToggleReaction([], "❤️", 1)));
    [Fact] public void SameReactionRemoves() => Assert.Equal(((string?)null, "❤️"), Norm(ChatRules.ToggleReaction(["❤️"], "❤️", 1)));
    [Fact] public void OneReactionReplaces() => Assert.Equal(("🔥", "❤️"), Norm(ChatRules.ToggleReaction(["❤️"], "🔥", 1)));
    [Fact] public void ThreeReactionsDropOldest() => Assert.Equal(("👌", "❤️"), Norm(ChatRules.ToggleReaction(["❤️", "🔥", "👏"], "👌", 3)));
    [Fact] public void RoomForSecondReaction() => Assert.Equal(("🔥", ""), Norm(ChatRules.ToggleReaction(["❤️"], "🔥", 2)));

    static (string?, string) Norm((string? Add, string[] Remove) x) => (x.Add, string.Join(",", x.Remove));

    // ------------------------------------------------------------ scheduled
    [Fact] public void ScheduleTooSoon() => Assert.False(ChatRules.ValidScheduleTime(T0.AddSeconds(10), T0));
    [Fact] public void ScheduleInAnHour() => Assert.True(ChatRules.ValidScheduleTime(T0.AddHours(1), T0));
    [Fact] public void ScheduleTooFar() => Assert.False(ChatRules.ValidScheduleTime(T0.AddDays(400), T0));

    // ------------------------------------------------------------ upload type sniffing
    [Fact] public void SniffJpeg() => Assert.Equal("image/jpeg", MediaStore.Sniff([0xFF, 0xD8, 0xFF, 0xE0, 0, 0]));
    [Fact] public void SniffPng() => Assert.Equal("image/png", MediaStore.Sniff([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0]));
    [Fact] public void SniffMp4() => Assert.Equal("video/mp4", MediaStore.Sniff([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D]));
    [Fact] public void SniffMov() => Assert.Equal("video/quicktime", MediaStore.Sniff([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]));
    [Fact] public void SniffWebm() => Assert.Equal("video/webm", MediaStore.Sniff([0x1A, 0x45, 0xDF, 0xA3, 1, 2]));
    [Fact] public void SniffHtmlIsNothing() => Assert.Null(MediaStore.Sniff("<html><script>"u8.ToArray()));
}
