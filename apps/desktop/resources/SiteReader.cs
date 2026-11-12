// prints what the address bar of one Chrome or Edge window holds, then exits. Started once per read with the window handle.
//   private           Incognito or InPrivate; the address is never read
//   typing            the user is in the address bar, so its text isn't a site
//   none              no address bar found
//   address <text>    the text in the bar
// Built by apps/desktop/scripts/build-site-reader.mjs; used by src/main/tracking/site.ts. Class names are the browsers' own and are the same in every language;
// the profile button's label is translated, so private windows are matched by its known wordings.
using System;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Automation;

static class SiteReader {
  static readonly Regex PrivateName = new Regex(
    "incognito|inkognito|incógnito|ছদ্মবেশী|inprivate",
    RegexOptions.IgnoreCase
  );

  static AutomationElement ByClass(AutomationElement root, params string[] names) {
    Condition condition = new PropertyCondition(AutomationElement.ClassNameProperty, names[0]);
    if (names.Length == 2) {
      condition = new OrCondition(condition, new PropertyCondition(AutomationElement.ClassNameProperty, names[1]));
    }
    return root.FindFirst(TreeScope.Descendants, condition);
  }

  static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    try {
      AutomationElement window = AutomationElement.FromHandle(new IntPtr(long.Parse(args[0])));

      AutomationElement avatar = ByClass(window, "AvatarToolbarButton", "EdgeAvatarToolbarButton");
      if (avatar != null && PrivateName.IsMatch(avatar.Current.Name)) {
        Console.WriteLine("private");
        return 0;
      }

      AutomationElement bar = ByClass(window, "OmniboxViewViews");
      if (bar == null) {
        Console.WriteLine("none");
        return 0;
      }
      if (bar.Current.HasKeyboardFocus) {
        Console.WriteLine("typing");
        return 0;
      }

      object pattern;
      if (!bar.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
        Console.WriteLine("none");
        return 0;
      }
      Console.WriteLine("address " + ((ValuePattern)pattern).Current.Value);
      return 0;
    } catch (Exception) {
      Console.WriteLine("none");
      return 1;
    }
  }
}
